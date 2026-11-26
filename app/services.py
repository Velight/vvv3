import math
from fastapi import HTTPException
from app.models import ClientState, Evidence


def find(items, item_id):
    a = next((x for x in items if x.id == item_id), None)
    if a is None:
        raise HTTPException(404, "Object not found in this client")
    return a


def check_evidence(state, evidence: list[Evidence]):
    for e in evidence:
        a = find(state.sources, e.source_id)
        if e.quote not in a.text:
            raise HTTPException(
                422, "Evidence quote must be an exact excerpt of the source"
            )


def check_relation(state, relation):
    find(state.people, relation.from_person_id)
    find(state.people, relation.to_person_id)
    if relation.deal_id:
        find(state.deals, relation.deal_id)
    check_evidence(state, relation.evidence)


def card(state, updates=0):
    c = [p for p in state.people if p.is_decision_maker]
    a = {d for x in state.interactions if x.kind != "note" for d in x.person_ids}
    b = sum(p.id in a for p in c)
    return {
        "id": state.id,
        "name": state.name,
        "industry": state.industry,
        "crm_id": state.crm_id,
        "version": state.version,
        "updated_at": state.updated_at,
        "contacts_count": len(state.people),
        "updates_count": updates,
        "coverage": {"covered": b, "total": len(c), "ratio": b / len(c) if c else None},
    }


def scoped(state, scope, scope_id):
    c = {p.id for p in state.people}
    e = [r for r in state.relations if r.status != "rejected"]
    b = state.deals
    if scope == "deal":
        a = find(state.deals, scope_id)
        e = [r for r in e if r.deal_id == scope_id]
        c = (
            set(a.participants)
            | {r.from_person_id for r in e}
            | {r.to_person_id for r in e}
        )
        b = [a]
    elif scope == "person":
        find(state.people, scope_id)
        e = [r for r in e if scope_id in (r.from_person_id, r.to_person_id)]
        c = {scope_id} | {r.from_person_id for r in e} | {r.to_person_id for r in e}
        b = [d for d in b if scope_id in d.participants]
    elif scope_id is not None:
        raise HTTPException(422, "scope_id is not used for client scope")
    return [p for p in state.people if p.id in c], e, b


def graph(
    state,
    scope="client",
    scope_id=None,
    department=None,
    relationship=None,
    status=None,
    q=None,
):
    f, g, b = scoped(state, scope, scope_id)
    f = [
        p
        for p in f
        if (not department or p.department == department)
        and (not relationship or p.relationship == relationship)
        and (not q or q.casefold() in (p.name + " " + p.title).casefold())
    ]
    c = {p.id for p in f}
    g = [
        r
        for r in g
        if r.from_person_id in c
        and r.to_person_id in c
        and (not status or r.status == status)
    ]
    j = {"strong": 1, "developing": 2, "weak": 3, "unknown": 4}
    e = []
    for i, p in enumerate(sorted(f, key=lambda x: x.id)):
        h = j[p.relationship]
        a = i * 2 * math.pi / max(len(f), 1)
        e.append(
            {
                "id": p.id,
                "type": "person",
                "data": p.model_dump(mode="json"),
                "ring": h,
                "position": {
                    "x": round(math.cos(a) * h * 110, 2),
                    "y": round(math.sin(a) * h * 110, 2),
                },
            }
        )
    return {
        "client": card(state),
        "version": state.version,
        "scope": scope,
        "scope_id": scope_id,
        "center": {"type": scope, "id": scope_id or state.id},
        "nodes": e,
        "edges": [
            {
                "id": r.id,
                "source": r.from_person_id,
                "target": r.to_person_id,
                "data": r.model_dump(mode="json"),
            }
            for r in g
        ],
        "deals": [d.model_dump(mode="json") for d in b],
        "ring_legend": j,
        "empty": not e,
    }


def context(state, scope="client", scope_id=None):
    h, i, b = scoped(state, scope, scope_id)
    f = {p.id for p in h}
    c = [e for x in [*h, *i] for e in x.evidence]
    j = {(e.source_id, e.quote): e for e in c}
    a = []
    for e in j.values():
        s = find(state.sources, e.source_id)
        a.append(
            {
                "source_id": s.id,
                "title": s.title,
                "date": s.source_date.isoformat(),
                "quote": e.quote,
            }
        )
    g = [
        x
        for x in state.interactions
        if f.intersection(x.person_ids) and (scope != "deal" or x.deal_id == scope_id)
    ]
    return {
        "client": card(state),
        "scope": scope,
        "scope_id": scope_id,
        "people": [p.model_dump(mode="json") for p in h],
        "relations": [r.model_dump(mode="json") for r in i],
        "deals": [d.model_dump(mode="json") for d in b],
        "interactions": [
            x.model_dump(mode="json")
            for x in sorted(g, key=lambda x: x.occurred_at)[-20:]
        ],
        "citations": a,
    }
