"""Transactional SQLite aggregate storage with immutable map revisions."""

import json
import sqlite3
from pathlib import Path
from contextlib import contextmanager
from fastapi import HTTPException
from app.models import ClientState, now, uid


class Store:
    def __init__(self, path):
        self.path = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as a:
            a.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS clients(id TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS revisions(
                client_id TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL,
                actor TEXT NOT NULL, action TEXT NOT NULL, data TEXT NOT NULL,
                PRIMARY KEY(client_id, version));
            CREATE TABLE IF NOT EXISTS jobs(
                id TEXT PRIMARY KEY, client_id TEXT NOT NULL, source_id TEXT NOT NULL,
                status TEXT NOT NULL, mode TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL,
                UNIQUE(client_id, source_id));
            CREATE TABLE IF NOT EXISTS sessions(
                id TEXT PRIMARY KEY, actor TEXT NOT NULL, client_id TEXT NOT NULL,
                scope TEXT NOT NULL, scope_id TEXT, messages TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS reads(
                actor TEXT NOT NULL, client_id TEXT NOT NULL, version INTEGER NOT NULL,
                PRIMARY KEY(actor, client_id));
            """)

    @contextmanager
    def connection(self):
        a = sqlite3.connect(self.path, timeout=15)
        a.row_factory = sqlite3.Row
        try:
            yield a
            a.commit()
        except Exception:
            a.rollback()
            raise
        finally:
            a.close()

    def get(self, client_id, version=None):
        with self.connection() as a:
            if version is None:
                b = a.execute(
                    "SELECT data FROM clients WHERE id=?", (client_id,)
                ).fetchone()
            else:
                b = a.execute(
                    "SELECT data FROM revisions WHERE client_id=? AND version=?",
                    (client_id, version),
                ).fetchone()
            if not b:
                raise HTTPException(404, "Client or revision not found")
            return ClientState.model_validate_json(b["data"])

    def all(self):
        with self.connection() as a:
            return [
                ClientState.model_validate_json(r[0])
                for r in a.execute("SELECT data FROM clients ORDER BY id")
            ]

    def _revision(self, db, state, actor, action):
        db.execute(
            "INSERT INTO revisions VALUES(?,?,?,?,?,?)",
            (
                state.id,
                state.version,
                state.updated_at,
                actor,
                action,
                state.model_dump_json(),
            ),
        )

    def create(self, state, actor):
        with self.connection() as a:
            a.execute(
                "INSERT INTO clients VALUES(?,?)", (state.id, state.model_dump_json())
            )
            self._revision(a, state, actor, "client.created")
        return state

    def mutate(self, client_id, expected_version, actor, action, change):
        with self.connection() as a:
            a.execute("BEGIN IMMEDIATE")
            c = a.execute(
                "SELECT data FROM clients WHERE id=?", (client_id,)
            ).fetchone()
            if not c:
                raise HTTPException(404, "Client not found")
            d = ClientState.model_validate_json(c["data"])
            if expected_version is not None and d.version != expected_version:
                raise HTTPException(
                    409,
                    {
                        "message": "Stale version; reload client",
                        "current_version": d.version,
                    },
                )
            b = change(d)
            d.version += 1
            d.updated_at = now()
            a.execute(
                "UPDATE clients SET data=? WHERE id=?", (d.model_dump_json(), client_id)
            )
            self._revision(a, d, actor, action)
            return {"version": d.version, "item": b}

    def history(self, client_id):
        with self.connection() as a:
            return [
                dict(r)
                for r in a.execute(
                    "SELECT version,created_at,actor,action FROM revisions WHERE client_id=? ORDER BY version",
                    (client_id,),
                )
            ]

    def unread(self, client_id, actor, version):
        with self.connection() as a:
            r = a.execute(
                "SELECT version FROM reads WHERE client_id=? AND actor=?",
                (client_id, actor),
            ).fetchone()
            return max(0, version - (r[0] if r else 1))

    def mark_read(self, client_id, actor, version):
        with self.connection() as a:
            a.execute(
                "INSERT INTO reads VALUES(?,?,?) ON CONFLICT(actor,client_id) DO UPDATE SET version=MAX(reads.version,excluded.version)",
                (actor, client_id, version),
            )

    def enqueue(self, client_id, source_id, mode):
        with self.connection() as a:
            a.execute(
                "INSERT OR IGNORE INTO jobs VALUES(?,?,?,?,?,?,?)",
                (
                    uid(),
                    client_id,
                    source_id,
                    "queued",
                    mode,
                    None,
                    now(),
                ),
            )
            return dict(
                a.execute(
                    "SELECT * FROM jobs WHERE client_id=? AND source_id=?",
                    (client_id, source_id),
                ).fetchone()
            )

    def job(self, job_id):
        with self.connection() as a:
            r = a.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if not r:
                raise HTTPException(404, "Job not found")
            return dict(r)

    def claim_job(self):
        with self.connection() as a:
            a.execute("BEGIN IMMEDIATE")
            b = a.execute(
                "SELECT * FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1"
            ).fetchone()
            if b:
                a.execute("UPDATE jobs SET status='running' WHERE id=?", (b["id"],))
                return dict(b)

    def finish_job(self, job_id, status, error=None):
        with self.connection() as a:
            a.execute(
                "UPDATE jobs SET status=?,error=? WHERE id=?", (status, error, job_id)
            )

    def session(self, session_id, actor, client_id, scope, scope_id):
        with self.connection() as a:
            if session_id:
                r = a.execute(
                    "SELECT * FROM sessions WHERE id=? AND actor=? AND client_id=?",
                    (session_id, actor, client_id),
                ).fetchone()
                if not r:
                    raise HTTPException(404, "Session not found")
                if r["scope"] != scope or r["scope_id"] != scope_id:
                    raise HTTPException(
                        409, "Create a new session for a different context"
                    )
                return json.loads(r["messages"])
            return []

    def save_chat(self, session_id, actor, client_id, scope, scope_id, messages):
        with self.connection() as a:
            a.execute(
                "INSERT INTO sessions VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET messages=excluded.messages",
                (
                    session_id,
                    actor,
                    client_id,
                    scope,
                    scope_id,
                    json.dumps(messages, ensure_ascii=False),
                ),
            )
