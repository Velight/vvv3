from fastapi.testclient import TestClient
from app.main import create_app

BASE = "/api/v1/clients/krasnodar"
KEYS = {"editor": {"role":"editor","user_id":"editor","clients":["*"]}}


def test_contact_sources_are_scoped_to_selected_revision(tmp_path, monkeypatch):
    monkeypatch.setenv("SEED_HISTORY", "true")
    with TestClient(create_app(tmp_path/"db", keys=KEYS, run_worker=False, public_demo_ui=True)) as c:
        old = c.get(BASE+"/people/krasnodar-p2?version=1").json()
        latest = c.get(BASE+"/people/krasnodar-p2?version=9").json()
        assert old["version"] == 1
        assert set(old["source_refs"]) == {"krasnodar-source"}
        assert latest["version"] == 9
        assert {r["status"] for r in latest["relations"]} >= {"confirmed","proposed"}
        for r in latest["relations"]:
            for ev in r["evidence"]:
                meta = latest["source_refs"][ev["source_id"]]
                assert meta["title"] and meta["source_date"]
                source = c.get(BASE+"/sources/"+ev["source_id"]+"?version=9").json()
                assert ev["quote"] in source["text"]
        assert c.get(BASE+"/sources/krasnodar-story-1?version=1").status_code == 404
        assert c.get(BASE+"/people/krasnodar-p2?version=999").status_code == 404
        graph = c.get(BASE+"/map?version=1").json()
        assert set(graph["source_refs"]) == {"krasnodar-source"}
        assert c.patch(BASE+"/people/krasnodar-p2",json={"expected_version":9,"changes":{"name":"Not allowed"}}).status_code == 403
        assert c.patch(BASE+"/people/krasnodar-p2",headers={"X-API-Key":"editor"},json={"expected_version":9,"changes":{"title":"Edited"}}).status_code == 200
        assert c.get(BASE+"/people/krasnodar-p2?version=9").json()["person"]["title"] == latest["person"]["title"]
        assert c.get(BASE+"/history").json()["items"][-1]["action"] == "person.updated"
