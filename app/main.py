import asyncio
import json
import os
import secrets
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Annotated, Literal
from fastapi import FastAPI, Depends, HTTPException, Query, Security
from fastapi.security import APIKeyHeader
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
from app.models import (
    ClientInput,
    ClientState,
    PersonInput,
    Person,
    PersonPatch,
    DealInput,
    Deal,
    RelationInput,
    Relation,
    Review,
    InteractionInput,
    Interaction,
    SourceInput,
    Source,
    ChatRequest,
    now,
    uid,
)
from app.store import Store
from app.seed import seed
from app.services import find, card, graph, context, check_evidence, check_relation
from app.ai import AI, worker
from app.mcp_server import create_mcp

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def create_app(db_path=None, keys=None, seed_demo=None, run_worker=True, ai=None):
    f = Store(db_path or os.getenv("DATABASE_PATH", "data/krok.db"))
    if keys is None:
        keys = json.loads(os.getenv("API_KEYS_JSON", "{}"))
    if not keys:
        raise RuntimeError(
            "Set API_KEYS_JSON; see .env.example. No anonymous access is enabled."
        )
    for c, g in keys.items():
        if (
            not c
            or g.get("role") not in ("editor", "viewer")
            or not g.get("user_id")
            or not isinstance(g.get("clients"), list)
        ):
            raise RuntimeError("Invalid API_KEYS_JSON entry")
    ai = ai or AI(
        os.getenv("LLM_BASE_URL", ""),
        os.getenv("LLM_MODEL", ""),
        os.getenv("LLM_API_KEY", ""),
    )
    b = (
        seed_demo
        if seed_demo is not None
        else os.getenv("SEED_DEMO", "true").lower() == "true"
    )

    mcp_server, mcp_app = create_mcp(f, keys)

    @asynccontextmanager
    async def lifespan(app):
        if b:
            seed(f)
        # One worker process only. Recover unfinished extraction after a restart.
        if run_worker:
            with f.connection() as d:
                d.execute("UPDATE jobs SET status='queued' WHERE status='running'")
        h = asyncio.Event()
        i = asyncio.create_task(worker(f, ai, h)) if run_worker else None
        try:
            async with mcp_server.session_manager.run():
                yield
        finally:
            h.set()
            if i:
                await i

    a = FastAPI(
        title="КРОК · Карта клиентских контактов",
        version="0.1.0",
        lifespan=lifespan,
        description="MVP: persistent client maps, reviewable evidence, history and scoped assistant. All seed data is synthetic.",
    )
    a.state.store, a.state.ai = f, ai
    e = [
        x.strip()
        for x in os.getenv(
            "CORS_ORIGINS", "http://localhost:3000,http://localhost:5173"
        ).split(",")
        if x.strip()
    ]
    a.add_middleware(
        CORSMiddleware,
        allow_origins=e,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "X-API-Key"],
    )

    def principal(key: str | None = Security(api_key_header)):
        for d, h in keys.items():
            if key is not None and secrets.compare_digest(key.encode(), d.encode()):
                return h
        raise HTTPException(401, "Valid X-API-Key required")

    User = Annotated[dict, Depends(principal)]

    def access(client_id, user, write=False):
        if "*" not in user["clients"] and client_id not in user["clients"]:
            raise HTTPException(404, "Client not found")
        if write and user["role"] != "editor":
            raise HTTPException(403, "Editor role required")

    def change(client_id, user, version, action, fn):
        access(client_id, user, True)
        return f.mutate(client_id, version, user["user_id"], action, fn)

    @a.get("/health", tags=["System"])
    def health():
        return {"status": "ok"}

    @a.get("/api/v1/me", tags=["System"])
    def me(user: User):
        return {**user, "assistant_mode": ai.mode, "assistant_model": ai.model, "mcp_url": "/mcp/"}

    @a.get("/api/v1/clients", tags=["Clients"])
    def clients(
        user: User,
        q: str = "",
        offset: int = Query(0, ge=0),
        limit: int = Query(50, ge=1, le=200),
    ):
        d = [
            s
            for s in f.all()
            if ("*" in user["clients"] or s.id in user["clients"])
            and q.casefold() in s.name.casefold()
        ]
        return {
            "items": [
                card(s, f.unread(s.id, user["user_id"], s.version))
                for s in d[offset : offset + limit]
            ],
            "total": len(d),
        }

    @a.post("/api/v1/clients", status_code=201, tags=["Clients"])
    def create_client(body: ClientInput, user: User):
        if user["role"] != "editor" or "*" not in user["clients"]:
            raise HTTPException(403, "Global editor required")
        return card(f.create(ClientState(**body.model_dump()), user["user_id"]))

    @a.get("/api/v1/clients/{client_id}", tags=["Clients"])
    def client(client_id: str, user: User):
        access(client_id, user)
        s = f.get(client_id)
        return card(s, f.unread(client_id, user["user_id"], s.version))

    @a.post("/api/v1/clients/{client_id}/read", tags=["Clients"])
    def read_updates(client_id: str, user: User, version: int = Query(ge=1)):
        access(client_id, user)
        if version > f.get(client_id).version:
            raise HTTPException(422, "Version exceeds current version")
        f.mark_read(client_id, user["user_id"], version)
        return {"read_version": version}

    @a.get("/api/v1/clients/{client_id}/map", tags=["Map"])
    def client_map(
        client_id: str,
        user: User,
        scope: Literal["client", "deal", "person"] = "client",
        scope_id: str | None = None,
        version: int | None = Query(None, ge=1),
        department: str | None = None,
        relationship: Literal["strong", "developing", "weak", "unknown"] | None = None,
        status: Literal["proposed", "confirmed"] | None = None,
        q: str | None = None,
    ):
        access(client_id, user)
        return graph(
            f.get(client_id, version),
            scope,
            scope_id,
            department,
            relationship,
            status,
            q,
        )

    @a.get("/api/v1/clients/{client_id}/history", tags=["Map"])
    def history(client_id: str, user: User):
        access(client_id, user)
        f.get(client_id)
        return {"items": f.history(client_id)}

    @a.get("/api/v1/clients/{client_id}/people", tags=["People"])
    def people(client_id: str, user: User, q: str = ""):
        access(client_id, user)
        s = f.get(client_id)
        return {
            "version": s.version,
            "items": [p for p in s.people if q.casefold() in p.name.casefold()],
        }

    @a.get("/api/v1/clients/{client_id}/people/{person_id}", tags=["People"])
    def person(client_id: str, person_id: str, user: User):
        access(client_id, user)
        s = f.get(client_id)
        p = find(s.people, person_id)
        return {
            "version": s.version,
            "person": p,
            "relations": [
                r
                for r in s.relations
                if person_id in (r.from_person_id, r.to_person_id)
            ],
            "deals": [d for d in s.deals if person_id in d.participants],
            "interactions": sorted(
                [i for i in s.interactions if person_id in i.person_ids],
                key=lambda i: i.occurred_at,
                reverse=True,
            ),
        }

    @a.post("/api/v1/clients/{client_id}/people", status_code=201, tags=["People"])
    def add_person(
        client_id: str,
        body: PersonInput,
        user: User,
        expected_version: int = Query(ge=1),
    ):
        def apply(s):
            check_evidence(s, body.evidence)
            p = Person(**body.model_dump())
            s.people.append(p)
            return p

        return change(client_id, user, expected_version, "person.created", apply)

    @a.patch("/api/v1/clients/{client_id}/people/{person_id}", tags=["People"])
    def edit_person(client_id: str, person_id: str, body: PersonPatch, user: User):
        def apply(s):
            p = find(s.people, person_id)
            if not set(body.changes) <= set(PersonInput.model_fields):
                raise HTTPException(422, "Only PersonInput fields can be edited")
            try:
                d = PersonInput.model_validate(
                    {**p.model_dump(exclude={"id", "updated_at"}), **body.changes}
                )
            except ValidationError as exc:
                raise HTTPException(422, json.loads(exc.json()))
            check_evidence(s, d.evidence)
            g = Person(**d.model_dump(), id=p.id, updated_at=now())
            s.people[s.people.index(p)] = g
            return g

        return change(client_id, user, body.expected_version, "person.updated", apply)

    @a.get("/api/v1/clients/{client_id}/deals", tags=["Deals"])
    def deals(client_id: str, user: User):
        access(client_id, user)
        s = f.get(client_id)
        return {"version": s.version, "items": s.deals}

    @a.post("/api/v1/clients/{client_id}/deals", status_code=201, tags=["Deals"])
    def add_deal(
        client_id: str, body: DealInput, user: User, expected_version: int = Query(ge=1)
    ):
        def apply(s):
            for g in body.participants:
                find(s.people, g)
            d = Deal(**body.model_dump())
            s.deals.append(d)
            return d

        return change(client_id, user, expected_version, "deal.created", apply)

    @a.get("/api/v1/clients/{client_id}/deals/{deal_id}", tags=["Deals"])
    def deal(client_id: str, deal_id: str, user: User):
        access(client_id, user)
        s = f.get(client_id)
        return {"version": s.version, "item": find(s.deals, deal_id)}

    @a.patch("/api/v1/clients/{client_id}/deals/{deal_id}", tags=["Deals"])
    def edit_deal(client_id: str, deal_id: str, body: PersonPatch, user: User):
        def apply(s):
            h = find(s.deals, deal_id)
            if not set(body.changes) <= set(DealInput.model_fields):
                raise HTTPException(422, "Only DealInput fields can be edited")
            try:
                g = DealInput.model_validate(
                    {**h.model_dump(exclude={"id"}), **body.changes}
                )
            except ValidationError as exc:
                raise HTTPException(422, json.loads(exc.json()))
            for i in g.participants:
                find(s.people, i)
            d = Deal(**g.model_dump(), id=h.id)
            s.deals[s.deals.index(h)] = d
            return d

        return change(client_id, user, body.expected_version, "deal.updated", apply)

    @a.get("/api/v1/clients/{client_id}/relations", tags=["Relations"])
    def relations(client_id: str, user: User):
        access(client_id, user)
        s = f.get(client_id)
        return {"version": s.version, "items": s.relations}

    @a.post(
        "/api/v1/clients/{client_id}/relations", status_code=201, tags=["Relations"]
    )
    def add_relation(
        client_id: str,
        body: RelationInput,
        user: User,
        expected_version: int = Query(ge=1),
    ):
        def apply(s):
            check_relation(s, body)
            r = Relation(
                **body.model_dump(),
                reviewed_by=user["user_id"] if body.status != "proposed" else None
            )
            s.relations.append(r)
            return r

        return change(client_id, user, expected_version, "relation.created", apply)

    @a.patch(
        "/api/v1/clients/{client_id}/relations/{relation_id}/review", tags=["Relations"]
    )
    def review(client_id: str, relation_id: str, body: Review, user: User):
        def apply(s):
            r = find(s.relations, relation_id)
            r.status, r.reviewed_by, r.updated_at = body.status, user["user_id"], now()
            if body.description is not None:
                r.description = body.description
            return r

        return change(
            client_id, user, body.expected_version, "relation.reviewed", apply
        )

    @a.get("/api/v1/clients/{client_id}/interactions", tags=["Interactions"])
    def interactions(
        client_id: str,
        user: User,
        person_id: str | None = None,
        deal_id: str | None = None,
    ):
        access(client_id, user)
        s = f.get(client_id)
        if person_id:
            find(s.people, person_id)
        if deal_id:
            find(s.deals, deal_id)
        return {
            "items": sorted(
                [
                    i
                    for i in s.interactions
                    if (not person_id or person_id in i.person_ids)
                    and (not deal_id or deal_id == i.deal_id)
                ],
                key=lambda i: i.occurred_at,
                reverse=True,
            )
        }

    @a.post(
        "/api/v1/clients/{client_id}/interactions",
        status_code=201,
        tags=["Interactions"],
    )
    def add_interaction(
        client_id: str,
        body: InteractionInput,
        user: User,
        expected_version: int = Query(ge=1),
    ):
        def apply(s):
            for d in body.person_ids:
                find(s.people, d)
            if body.deal_id:
                find(s.deals, body.deal_id)
            if body.source_id:
                find(s.sources, body.source_id)
            i = Interaction(**body.model_dump())
            s.interactions.append(i)
            return i

        return change(client_id, user, expected_version, "interaction.created", apply)

    @a.get("/api/v1/clients/{client_id}/sources", tags=["Sources"])
    def sources(client_id: str, user: User):
        access(client_id, user)
        s = f.get(client_id)
        return {
            "version": s.version,
            "items": [x.model_dump(exclude={"text"}) for x in s.sources],
        }

    @a.get("/api/v1/clients/{client_id}/sources/{source_id}", tags=["Sources"])
    def source(client_id: str, source_id: str, user: User):
        access(client_id, user)
        return find(f.get(client_id).sources, source_id)

    @a.post("/api/v1/clients/{client_id}/sources", status_code=201, tags=["Sources"])
    def add_source(
        client_id: str,
        body: SourceInput,
        user: User,
        expected_version: int = Query(ge=1),
    ):
        def apply(s):
            d = Source(**body.model_dump())
            s.sources.append(d)
            return d

        return change(client_id, user, expected_version, "source.created", apply)

    @a.post(
        "/api/v1/clients/{client_id}/sources/{source_id}/process",
        status_code=202,
        tags=["Sources"],
    )
    def process_source(client_id: str, source_id: str, user: User):
        access(client_id, user, True)
        find(f.get(client_id).sources, source_id)
        return f.enqueue(client_id, source_id, ai.mode)

    @a.get("/api/v1/jobs/{job_id}", tags=["Sources"])
    def job(job_id: str, user: User):
        d = f.job(job_id)
        access(d["client_id"], user)
        return d

    @a.get("/api/v1/clients/{client_id}/context", tags=["Assistant"])
    def agent_context(
        client_id: str,
        user: User,
        scope: Literal["client", "deal", "person"] = "client",
        scope_id: str | None = None,
    ):
        access(client_id, user)
        return context(f.get(client_id), scope, scope_id)

    @a.get("/api/v1/clients/{client_id}/chat/sessions", tags=["Assistant"])
    def sessions(client_id: str, user: User):
        access(client_id, user)
        f.get(client_id)
        with f.connection() as d:
            return {
                "items": [
                    dict(r)
                    for r in d.execute(
                        "SELECT id,scope,scope_id FROM sessions WHERE actor=? AND client_id=? ORDER BY rowid DESC",
                        (user["user_id"], client_id),
                    )
                ]
            }

    @a.get("/api/v1/clients/{client_id}/chat/sessions/{session_id}", tags=["Assistant"])
    def chat_history(client_id: str, session_id: str, user: User):
        access(client_id, user)
        with f.connection() as d:
            r = d.execute(
                "SELECT * FROM sessions WHERE id=? AND actor=? AND client_id=?",
                (session_id, user["user_id"], client_id),
            ).fetchone()
            if not r:
                raise HTTPException(404, "Session not found")
            return {
                "id": r["id"],
                "scope": r["scope"],
                "scope_id": r["scope_id"],
                "messages": json.loads(r["messages"]),
            }

    @a.post("/api/v1/clients/{client_id}/chat", tags=["Assistant"])
    def chat(client_id: str, body: ChatRequest, user: User):
        access(client_id, user)
        h = context(f.get(client_id, body.version), body.scope, body.scope_id)
        i = f.session(
            body.session_id, user["user_id"], client_id, body.scope, body.scope_id
        )
        try:
            d = ai.answer(body.message, h, i)
        except Exception:
            raise HTTPException(502, "Model unavailable; try again later")
        j = body.session_id or uid()
        i += [
            {"role": "user", "content": body.message, "created_at": now()},
            {"role": "assistant", "content": d, "created_at": now()},
        ]
        f.save_chat(j, user["user_id"], client_id, body.scope, body.scope_id, i)
        return {
            "session_id": j,
            "mode": ai.mode,
            "answer": d,
            "context_version": h["client"]["version"],
            "citations": h["citations"],
            "messages": i,
        }

    a.mount("/mcp", mcp_app)

    # Register after API routes so unknown /api URLs never receive index.html.
    frontend = Path(__file__).resolve().parent.parent / "frontend"
    if frontend.is_dir():
        a.mount("/", StaticFiles(directory=frontend, html=True), name="frontend")
    return a
