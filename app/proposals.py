"""CRM pull requests: immutable proposals, atomic merge and explicit rejection."""
import json
from typing import Literal
from pydantic import Field, ValidationError
from fastapi import HTTPException
from app.models import Model, Person, PersonInput, Relation, RelationInput, ClientState, now, uid
from app.services import find, check_evidence, check_relation

FIELDS = ("name", "title", "department", "relationship", "is_decision_maker", "communication_notes", "email", "phone")
LABELS = {"name":"Имя","title":"Должность","department":"Подразделение","relationship":"Отношения","is_decision_maker":"ЛПР","communication_notes":"Особенности общения","email":"Почта","phone":"Телефон"}

class ContactProposal(Model):
    expected_version: int = Field(ge=1)
    person_id: str | None = None
    changes: dict = Field(min_length=1)
    reason: str = Field(default="", max_length=4000)
    source_id: str | None = None
    quote: str = Field(default="", max_length=4000)


class Decision(Model):
    decision: Literal["merge", "reject"]


def read_state(db, client_id):
    row = db.execute("SELECT data FROM clients WHERE id=?", (client_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Client not found")
    return ClientState.model_validate_json(row["data"])


def insert(db, state, author, title, changes, *, proposal_id=None, demo=False, reason=""):
    key = proposal_id or uid()
    proposal = {"id": key, "client_id": state.id, "base_version": state.version,
                "title": title, "reason": reason, "author": author, "created_at": now(),
                "status": "open", "changes": changes, "reviewed_at": None,
                "reviewed_by": None, "merged_version": None}
    db.execute("INSERT OR IGNORE INTO proposals(id,client_id,demo,data) VALUES(?,?,?,?)",
               (key, state.id, int(demo), json.dumps(proposal, ensure_ascii=False)))
    return json.loads(db.execute("SELECT data FROM proposals WHERE id=?", (key,)).fetchone()[0])


def evidence(state, source_id, quote):
    if not source_id and not quote:
        return [], None
    if not source_id or not quote:
        raise HTTPException(422, "Select a source and exact quote together")
    source = find(state.sources, source_id)
    if quote not in source.text:
        raise HTTPException(422, "Evidence quote must be an exact excerpt of the source")
    return [{"source_id": source_id, "quote": quote}], {
        "id": source.id, "title": source.title,
        "date": source.source_date.isoformat(), "quote": quote}


def create_contact(store, client_id, actor, body):
    if not set(body.changes) <= set(FIELDS):
        raise HTTPException(422, "Unsupported contact field")
    with store.connection() as db:
        db.execute("BEGIN IMMEDIATE")
        state = read_state(db, client_id)
        if state.version != body.expected_version:
            raise HTTPException(409, "Stale version; reload client")
        old = find(state.people, body.person_id) if body.person_id else None
        before = old.model_dump(mode="json", exclude={"id","updated_at"}) if old else {}
        ev, src = evidence(state, body.source_id, body.quote)
        try:
            candidate = PersonInput.model_validate({**before, **body.changes,
                "evidence": before.get("evidence", []) + ev}).model_dump(mode="json")
        except ValidationError as exc:
            raise HTTPException(422, json.loads(exc.json())) from exc
        changed = {k: candidate[k] for k in FIELDS if (not old and k in body.changes) or (old and before[k] != candidate[k])}
        if not changed:
            raise HTTPException(422, "No contact fields changed")
        change = {"kind": "contact.update" if old else "contact.create",
                  "target_id": old.id if old else uid(), "target": candidate["name"],
                  "before": {k: before[k] for k in changed} if old else {},
                  "after": changed, "source": src, "evidence": ev}
        return insert(db, state, actor, ("Правка: " if old else "Новый контакт: ") + candidate["name"],
                      [change], reason=body.reason)


def create_extraction(store, client_id, source_id, job_id, relations):
    with store.connection() as db:
        db.execute("BEGIN IMMEDIATE")
        state = read_state(db, client_id)
        source = find(state.sources, source_id)
        changes = []
        for i, relation in enumerate(relations):
            relation.status = "proposed"
            if not relation.evidence or any(e.source_id != source_id for e in relation.evidence):
                raise ValueError("Extraction requires evidence from this source")
            check_relation(state, relation)
            a = find(state.people, relation.from_person_id)
            b = find(state.people, relation.to_person_id)
            raw = relation.model_dump(mode="json")
            changes.append({"kind":"relation.create", "target_id":f"{job_id}:{i}",
                            "target":a.name+" → "+b.name, "before":{},
                            "after":raw, "source":{"id":source.id,"title":source.title,
                            "date":source.source_date.isoformat(),"quote":relation.evidence[0].quote}})
        if changes:
            return insert(db, state, "worker", "Из источника: "+source.title, changes,
                          proposal_id="job-"+job_id, reason="Автоматическое извлечение; проверьте все выводы.")
        return None


def seed_demo_proposals(store):
    """Populate substantive examples using existing synthetic source excerpts."""
    for s in store.all():
        if s.id not in ("krasnodar","vtb","mvideo") or s.crm_id != "demo-"+s.id:
            continue
        if any(h["actor"] != "seed" for h in store.history(s.id)):
            continue
        with store.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            state = read_state(db, s.id)
            source_id = state.id+"-source"
            source = next((x for x in state.sources if x.id==source_id),None)
            if not source:
                continue
            changes = []
            for suffix, quote, note in (
                ("-p1","Николай Орлов согласует требования ИБ.","Согласует требования ИБ."),
                ("-p2","Ирина Кузнецова ведёт закупку.","Ведёт закупку по проекту обновления защиты инфраструктуры."),
            ):
                p = next((x for x in state.people if x.id==state.id+suffix),None)
                if not p or quote not in source.text or p.communication_notes==note:
                    continue
                ev, src = evidence(state,source_id,quote)
                changes.append({"kind":"contact.update","target_id":p.id,"target":p.name,
                    "before":{"communication_notes":p.communication_notes},
                    "after":{"communication_notes":note},"source":src,"evidence":ev})
            r = next((x for x in state.relations if x.id==state.id+"-r1" and x.status=="proposed"),None)
            quote = "Николай Орлов обсуждает требования с Ириной Кузнецовой."
            if r and quote in source.text and any(e.source_id==source_id and e.quote==quote for e in r.evidence):
                _, src = evidence(state,source_id,quote)
                changes.append({"kind":"relation.review","target_id":r.id,
                    "target":"Николай Орлов → Ирина Кузнецова",
                    "before":{"status":"proposed","description":r.description},
                    "after":{"status":"confirmed","description":"Согласование требований ИБ между службой безопасности и закупками"},
                    "description":r.description,"source":src})
            if not changes:
                continue
            key = "demo-review-"+state.id
            old = db.execute("SELECT data FROM proposals WHERE id=? AND client_id=? AND demo=1",(key,state.id)).fetchone()
            # Upgrade only the old untouched, open fixture. Never rewrite a review decision.
            if old:
                previous = json.loads(old[0])
                if previous["status"]!="open" or previous["title"]!="Проверка связей из протоколов" or previous["author"]!="Демо-агент":
                    continue
                db.execute("DELETE FROM proposals WHERE id=? AND client_id=? AND demo=1",(key,state.id))
            insert(db,state,"Ассистент CRM","Уточнить обязанности и взаимодействие по проекту",
                changes,proposal_id=key,demo=True,
                reason="В протоколе встречи зафиксированы ответственные за требования ИБ и закупку. Уточнить карточки и описание взаимодействия.")

def list_proposals(store, client_id, public=False):
    with store.connection() as db:
        rows = db.execute("SELECT data FROM proposals WHERE client_id=? AND (?=0 OR demo=1)",
                          (client_id, int(public))).fetchall()
        result = [json.loads(row[0]) for row in rows]
        if public:
            for item in result:
                if item["reviewed_by"]:
                    item["reviewed_by"] = "Редактор"
        return sorted(result, key=lambda x: (x["status"]=="open", x["created_at"]), reverse=True)


def decide(store, client_id, proposal_id, actor, decision):
    with store.connection() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT data FROM proposals WHERE id=? AND client_id=?",
                         (proposal_id,client_id)).fetchone()
        if not row:
            raise HTTPException(404, "Proposal not found")
        pr = json.loads(row[0])
        if pr["status"] != "open":
            raise HTTPException(409, "Proposal already reviewed")
        state = read_state(db, client_id)
        if decision == "merge":
            # Compare touched fields, not the global version: unrelated changes
            # can merge safely; conflicting edits require a fresh proposal.
            for c in pr["changes"]:
                kind = c["kind"]
                if kind in ("contact.update","contact.create"):
                    old = find(state.people,c["target_id"]) if kind=="contact.update" else None
                    before = old.model_dump(mode="json",exclude={"id","updated_at"}) if old else {}
                    if old and any(before[k]!=v for k,v in c["before"].items()):
                        raise HTTPException(409,"Contact has conflicting changes; create a new proposal")
                    if not old and any(p.name.casefold()==c["after"]["name"].casefold() for p in state.people):
                        raise HTTPException(409,"A contact with this name already exists")
                    data = PersonInput.model_validate({**before,**c["after"],
                        "evidence":before.get("evidence",[])+c.get("evidence",[])})
                    check_evidence(state,data.evidence)
                    person = Person(**data.model_dump(),id=c["target_id"],updated_at=now())
                    if old: state.people[state.people.index(old)]=person
                    else: state.people.append(person)
                elif kind=="relation.create":
                    r = Relation(**c["after"],id=c["target_id"],reviewed_by=actor)
                    check_relation(state,r)
                    if any(x.id==r.id for x in state.relations):
                        raise HTTPException(409,"Relation already exists")
                    r.status="confirmed"
                    state.relations.append(r)
                elif kind=="relation.review":
                    r = find(state.relations,c["target_id"])
                    if r.status!=c["before"]["status"] or r.description!=c["description"]:
                        raise HTTPException(409,"Relation has conflicting changes")
                    check_relation(state,r)
                    r.status=c["after"]["status"]
                    if "description" in c["after"]:
                        r.description=c["after"]["description"]
                    r.reviewed_by=actor
                    r.updated_at=now()
                else:
                    raise HTTPException(422,"Unsupported proposal change")
            state.version+=1
            state.updated_at=now()
            db.execute("UPDATE clients SET data=? WHERE id=?",(state.model_dump_json(),client_id))
            store._revision(db,state,actor,"proposal.merged:"+proposal_id)
            pr["merged_version"]=state.version
        pr["status"]="merged" if decision=="merge" else "rejected"
        pr["reviewed_by"],pr["reviewed_at"]=actor,now()
        db.execute("UPDATE proposals SET data=? WHERE id=?",(json.dumps(pr,ensure_ascii=False),proposal_id))
        return pr
