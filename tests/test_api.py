import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.ai import AI, process_job

KEYS = {
    "editor": {"user_id": "editor", "role": "editor", "clients": ["*"]},
    "viewer": {"user_id": "viewer", "role": "viewer", "clients": ["krasnodar"]},
}
BASE = "/api/v1/clients/krasnodar"


@pytest.fixture
def client(tmp_path):
    with TestClient(
        create_app(tmp_path / "test.db", keys=KEYS, seed_demo=True, run_worker=False),
        headers={"X-API-Key": "editor"},
    ) as c:
        yield c


def test_access_and_coverage(client):
    assert client.get("/api/v1/clients", headers={"X-API-Key": ""}).status_code == 401
    r = client.get("/api/v1/clients", headers={"X-API-Key": "viewer"}).json()
    assert [x["id"] for x in r["items"]] == ["krasnodar"]
    assert (
        client.get(
            "/api/v1/clients/vtb/map", headers={"X-API-Key": "viewer"}
        ).status_code
        == 404
    )
    assert client.get("/api/v1/clients/s7/map").json()["empty"] is True
    assert client.get("/api/v1/clients/s7").json()["coverage"]["ratio"] is None
    assert client.get(BASE).json()["coverage"] == {
        "covered": 1,
        "total": 3,
        "ratio": 1 / 3,
    }


def test_review_history_stale_write(client):
    a = client.get(BASE + "/map").json()
    r = client.patch(
        BASE + "/relations/krasnodar-r1/review",
        json={
            "expected_version": 1,
            "status": "confirmed",
            "description": "Согласует ИБ, но не бюджет",
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["version"] == 2
    assert client.get(BASE + "/map?version=1").json() == a
    b = client.get(BASE + "/context").json()
    assert b["relations"][0]["status"] == "confirmed"
    assert b["relations"][0]["description"] == "Согласует ИБ, но не бюджет"
    assert (
        client.patch(
            BASE + "/people/krasnodar-p1",
            json={"expected_version": 1, "changes": {"title": "X"}},
        ).status_code
        == 409
    )
    assert len(client.get(BASE + "/history").json()["items"]) == 2
    assert client.get(BASE).json()["updates_count"] == 1
    client.post(BASE + "/read?version=2")
    assert client.get(BASE).json()["updates_count"] == 0


def test_validation_and_cross_client_references(client):
    assert (
        client.post(
            BASE + "/people?expected_version=1", json={"name": "  "}
        ).status_code
        == 422
    )
    for a in [{"id": "fake"}, {"name": None}]:
        assert (
            client.patch(
                BASE + "/people/krasnodar-p1",
                json={"expected_version": 1, "changes": a},
            ).status_code
            == 422
        )
    assert (
        client.post(
            BASE + "/relations?expected_version=1",
            json={
                "from_person_id": "krasnodar-p1",
                "to_person_id": "vtb-p1",
                "kind": "influences",
            },
        ).status_code
        == 404
    )
    assert (
        client.post(
            BASE + "/relations?expected_version=1",
            json={
                "from_person_id": "krasnodar-p1",
                "to_person_id": "krasnodar-p2",
                "kind": "influences",
                "evidence": [{"source_id": "krasnodar-source", "quote": "invented"}],
            },
        ).status_code
        == 422
    )
    assert client.get(BASE).json()["version"] == 1
    assert (
        client.post(
            BASE + "/people?expected_version=1",
            json={"name": "X"},
            headers={"X-API-Key": "viewer"},
        ).status_code
        == 403
    )


def test_scopes_filters(client):
    assert (
        len(client.get(BASE + "/map?scope=deal&scope_id=krasnodar-d1").json()["nodes"])
        == 2
    )
    g = client.get(BASE + "/map?department=ИБ").json()
    assert len(g["nodes"]) == 2 and g["edges"] == []
    assert client.get(BASE + "/map?scope=person&scope_id=vtb-p1").status_code == 404
    assert client.get(BASE + "/map?scope=deal").status_code == 404
    assert client.get(BASE + "/map?scope_id=unused").status_code == 422


def test_chat_current_context_session_acl(client):
    a = client.post(BASE + "/chat", json={"message": "Кого позвать?"}).json()
    assert a["mode"] == "demo" and a["context_version"] == 1
    client.patch(
        BASE + "/relations/krasnodar-r1/review",
        json={
            "expected_version": 1,
            "status": "confirmed",
            "description": "Новое уточнение",
        },
    )
    b = client.post(
        BASE + "/chat",
        json={"message": "Что изменилось?", "session_id": a["session_id"]},
    ).json()
    assert "Новое уточнение" in b["answer"] and b["context_version"] == 2
    assert len(b["messages"]) == 4
    assert (
        client.post(
            BASE + "/chat",
            json={"message": "X", "session_id": a["session_id"]},
            headers={"X-API-Key": "viewer"},
        ).status_code
        == 404
    )
    assert (
        client.post(
            BASE + "/chat",
            json={
                "message": "X",
                "session_id": a["session_id"],
                "scope": "person",
                "scope_id": "krasnodar-p1",
            },
        ).status_code
        == 409
    )


def test_source_processing_flow(client):
    c = client.post(
        BASE + "/sources?expected_version=1",
        json={
            "title": "Протокол",
            "text": "Николай Орлов и Ирина Кузнецова согласуют требования.",
            "source_date": "2026-11-25T12:00:00+03:00",
        },
    ).json()["item"]
    j = client.post(BASE + f"/sources/{c['id']}/process").json()
    assert client.post(BASE + f"/sources/{c['id']}/process").json()["id"] == j["id"]
    d = client.app.state.store
    process_job(d, client.app.state.ai, d.claim_job())
    assert client.get("/api/v1/jobs/" + j["id"]).json()["status"] == "completed"
    b = client.get(BASE + "/relations").json()["items"]
    a = next(r for r in b if r["id"].startswith(j["id"]))
    assert a["status"] == "proposed" and a["evidence"][0]["quote"] in c["text"]
    e = client.get(BASE).json()["version"]
    assert (
        client.patch(
            BASE + f"/relations/{a['id']}/review",
            json={"expected_version": e, "status": "confirmed"},
        ).status_code
        == 200
    )


def test_persistence(tmp_path):
    a = tmp_path / "persist.db"
    with TestClient(
        create_app(a, keys=KEYS, run_worker=False), headers={"X-API-Key": "editor"}
    ) as c:
        assert (
            c.patch(
                BASE + "/people/krasnodar-p1",
                json={"expected_version": 1, "changes": {"title": "Updated"}},
            ).status_code
            == 200
        )
    with TestClient(
        create_app(a, keys=KEYS, run_worker=False), headers={"X-API-Key": "editor"}
    ) as c:
        assert (
            c.get(BASE + "/people/krasnodar-p1").json()["person"]["title"] == "Updated"
        )
        assert c.get(BASE).json()["version"] == 2


def test_interaction_coverage(client):
    r = client.post(
        BASE + "/interactions?expected_version=1",
        json={
            "person_ids": ["krasnodar-p2"],
            "kind": "call",
            "occurred_at": "2026-11-25T10:00:00Z",
            "summary": "Обсудили закупки",
        },
    )
    assert r.status_code == 201, r.text
    assert client.get(BASE).json()["coverage"]["covered"] == 2


def test_failed_extraction_atomic(client):
    from app.models import Extraction

    class BadAI(AI):
        def extract(self, state, source):
            return Extraction.model_validate(
                {
                    "relations": [
                        {
                            "from_person_id": "krasnodar-p1",
                            "to_person_id": b,
                            "kind": "influences",
                            "evidence": [
                                {
                                    "source_id": source.id,
                                    "quote": "Николай Орлов согласует требования ИБ.",
                                }
                            ],
                        }
                        for b in ["krasnodar-p2", "vtb-p1"]
                    ]
                }
            )

    a = client.app.state.store
    j = a.enqueue("krasnodar", "krasnodar-source", "llm")
    process_job(a, BadAI(), a.claim_job())
    assert a.job(j["id"])["status"] == "failed"
    assert a.get("krasnodar").version == 1
    assert len(a.get("krasnodar").relations) == 1


def test_deal_edits_and_chat_history(client):
    r = client.patch(
        BASE + "/deals/krasnodar-d1",
        json={"expected_version": 1, "changes": {"stage": "proposal"}},
    )
    assert r.status_code == 200
    assert (
        client.get(BASE + "/deals/krasnodar-d1").json()["item"]["stage"] == "proposal"
    )
    a = client.post(BASE + "/chat", json={"message": "Контекст?"}).json()
    b = client.get(BASE + "/chat/sessions").json()["items"]
    assert b[0]["id"] == a["session_id"]
    assert (
        len(client.get(BASE + "/chat/sessions/" + a["session_id"]).json()["messages"])
        == 2
    )
    assert (
        client.get(
            BASE + "/chat/sessions/" + a["session_id"], headers={"X-API-Key": "viewer"}
        ).status_code
        == 404
    )


def test_competing_writes(client):
    from concurrent.futures import ThreadPoolExecutor

    def update(title):
        return client.patch(
            BASE + "/people/krasnodar-p1",
            json={"expected_version": 1, "changes": {"title": title}},
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as a:
        b = list(a.map(update, ["First", "Second"]))
    assert sorted(b) == [200, 409]
    assert client.get(BASE).json()["version"] == 2


def test_openapi(client):
    a = client.get("/openapi.json").json()
    assert a["components"]["securitySchemes"]["APIKeyHeader"]["name"] == "X-API-Key"
    assert "/api/v1/clients/{client_id}/map" in a["paths"]


def test_private_model_http_contract(monkeypatch):
    import json
    import httpx

    c = httpx.Client
    b = []

    def respond(request):
        b.append(json.loads(request.content))
        assert str(request.url) == "http://private-model/v1/chat/completions"
        assert request.headers["Authorization"] == "Bearer test-only"
        return httpx.Response(
            200, json={"choices": [{"message": {"content": '{"facts":[0]}'}}]}
        )

    monkeypatch.setattr(
        "app.ai.httpx.Client",
        lambda **kw: c(transport=httpx.MockTransport(respond), **kw),
    )
    a = AI("http://private-model/v1", "private-model", "test-only")
    assert a.answer("Вопрос?", {"client": {"id": "test"}}, []) == "Количество контактов в выбранном контексте: 0."
    assert b[0]["model"] == "private-model"
    assert "facts" in json.loads(b[0]["messages"][1]["content"])
    assert b[0]["response_format"]["type"] == "json_schema"


def test_rejected_relation_removed_from_current_map(client):
    r = client.patch(
        BASE + "/relations/krasnodar-r1/review",
        json={"expected_version": 1, "status": "rejected"},
    )
    assert r.status_code == 200
    assert client.get(BASE + "/map").json()["edges"] == []
    assert len(client.get(BASE + "/map?version=1").json()["edges"]) == 1
    assert client.get(BASE + "/context").json()["relations"] == []


def test_evidence_from_other_client_rejected(client):
    r = client.patch(
        BASE + "/people/krasnodar-p1",
        json={
            "expected_version": 1,
            "changes": {
                "evidence": [
                    {
                        "source_id": "vtb-source",
                        "quote": "Николай Орлов согласует требования ИБ.",
                    }
                ]
            },
        },
    )
    assert r.status_code == 404
    assert client.get(BASE).json()["version"] == 1
