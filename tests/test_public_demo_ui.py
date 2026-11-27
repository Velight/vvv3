from fastapi.testclient import TestClient
from app.ai import AI
from app.main import create_app
from app.models import ClientState

KEYS = {"editor": {"role": "editor", "user_id": "editor", "clients": ["*"]}}
BASE = "/api/v1/clients/krasnodar"


def test_public_prototype_without_key_is_scoped_read_only(tmp_path, monkeypatch):
    ai = AI("http://127.0.0.1:1/v1", "test-model")
    def forbidden(*args, **kwargs):
        raise AssertionError("Anonymous analytics must not call an LLM")
    monkeypatch.setattr(ai, "answer", forbidden)
    app = create_app(tmp_path/"db", keys=KEYS, ai=ai, run_worker=False, public_demo_ui=True)
    with TestClient(app) as c:
        app.state.store.create(ClientState(id="private", name="Private", crm_id="private"), "editor")
        me = c.get("/api/v1/me").json()
        assert me["public_demo"] and me["role"] == "viewer"
        assert me["mcp_url"] == "/mcp-demo/" and me["assistant_mode"] == "analytics"
        assert {x["id"] for x in c.get("/api/v1/clients").json()["items"]} == {"krasnodar", "vtb", "mvideo", "s7"}
        assert c.get("/api/v1/clients/private/map").status_code == 404
        assert c.get(BASE+"/map").status_code == 200
        assert c.get(BASE+"/history").status_code == 200
        assert c.get(BASE+"/sources").status_code == 200
        assert c.patch(BASE+"/people/krasnodar-p1", json={"expected_version": 1, "changes": {"name": "Blocked"}}).status_code == 403
        assert c.post(BASE+"/sources/krasnodar-source/process").status_code == 403
        answer = c.post(BASE+"/chat", json={"message": "Сводка"}).json()
        assert answer["mode"] == "analytics"
        assert c.get(BASE+"/chat/sessions").json() == {"items": []}
        assert c.get(BASE+"/chat/sessions/"+answer["session_id"]).status_code == 404
        with app.state.store.connection() as conn:
            assert conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 0
        assert c.get("/api/v1/me", headers={"X-API-Key": "wrong"}).status_code == 401
        assert c.get("/api/v1/clients/private", headers={"X-API-Key": "editor"}).status_code == 200
        assert c.get("/api/v1/me", headers={"X-API-Key": "editor"}).json()["role"] == "editor"
        assert c.post("/mcp/", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"}).status_code == 401


def test_render_prototype_default_and_private_deployment(tmp_path, monkeypatch):
    monkeypatch.delenv("PUBLIC_DEMO_UI", raising=False)
    monkeypatch.setenv("RENDER_EXTERNAL_HOSTNAME", "vvv3.onrender.com")
    with TestClient(create_app(tmp_path/"demo", keys={}, run_worker=False)) as c:
        assert c.get("/api/v1/me").json()["public_demo"]
    monkeypatch.setenv("PUBLIC_DEMO_UI", "false")
    with TestClient(create_app(tmp_path/"private", keys=KEYS, run_worker=False)) as c:
        assert c.get("/api/v1/me").status_code == 401
