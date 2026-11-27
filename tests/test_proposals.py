from fastapi.testclient import TestClient
from app.main import create_app

KEYS = {"editor": {"role":"editor","user_id":"editor","clients":["*"]},
        "viewer":{"role":"viewer","user_id":"viewer","clients":["krasnodar"]}}
BASE = "/api/v1/clients/krasnodar"
EDITOR = {"X-API-Key":"editor"}

def test_proposals_merge_conflicts_reject_and_permissions(tmp_path):
    with TestClient(create_app(tmp_path/"db",keys=KEYS,run_worker=False,public_demo_ui=True)) as c:
        def propose(changes, person_id="krasnodar-p1", version=1, **kw):
            return c.post(BASE+"/proposals",headers=EDITOR,json={
                "expected_version":version,"person_id":person_id,"changes":changes,**kw})
        def decide(p, decision="merge", headers=EDITOR, base=BASE):
            return c.post(base+"/proposals/"+p["id"]+"/decision",headers=headers,json={"decision":decision})
        guest = c.get(BASE+"/proposals").json()["items"]
        assert guest and all(p["id"].startswith("demo-review-") for p in guest)
        assert decide(guest[0],headers={}).status_code==403
        assert propose({"title":"Новая роль"},quote="fake",source_id="krasnodar-source").status_code==422
        first=propose({"title":"Новая роль"}).json()
        conflict=propose({"title":"Другая роль"}).json()
        unrelated=propose({"department":"Проекты"}).json()
        rejected=propose({"name":"Отклонённое имя"}).json()
        assert c.get(BASE,headers=EDITOR).json()["version"]==1
        assert first["changes"][0]["before"]["title"]=="Руководитель ИБ"
        assert first["id"] not in {p["id"] for p in c.get(BASE+"/proposals").json()["items"]}
        assert decide(first,base="/api/v1/clients/vtb").status_code==404
        assert decide(first,headers={"X-API-Key":"viewer"}).status_code==403
        assert decide(first).json()["merged_version"]==2
        assert decide(first).status_code==409
        assert decide(conflict).status_code==409
        assert decide(unrelated).json()["merged_version"]==3
        assert decide(rejected,"reject").json()["status"]=="rejected"
        assert c.get(BASE,headers=EDITOR).json()["version"]==3
        old=c.get(BASE+"/people/krasnodar-p1?version=1",headers=EDITOR).json()["person"]
        new=c.get(BASE+"/people/krasnodar-p1",headers=EDITOR).json()["person"]
        assert old["title"]=="Руководитель ИБ" and new["title"]=="Новая роль" and new["department"]=="Проекты"
        assert new["name"]==old["name"]
        assert c.get(BASE+"/history",headers=EDITOR).json()["items"][-1]["action"]=="proposal.merged:"+unrelated["id"]
        contact=propose({"name":"Демо Новый контакт","title":"Руководитель"},person_id=None,version=3).json()
        assert decide(contact).json()["merged_version"]==4
        people=c.get(BASE+"/people",headers=EDITOR).json()["items"]
        assert any(p["name"]=="Демо Новый контакт" for p in people)

def test_demo_proposal_is_a_single_atomic_revision(tmp_path):
    with TestClient(create_app(tmp_path/"db",keys=KEYS,run_worker=False,public_demo_ui=True)) as c:
        p=c.get(BASE+"/proposals").json()["items"][0]
        r=c.post(BASE+"/proposals/"+p["id"]+"/decision",headers=EDITOR,json={"decision":"merge"})
        assert r.status_code==200 and r.json()["merged_version"]==2
        assert c.get(BASE+"/history",headers=EDITOR).json()["items"][-1]["action"].startswith("proposal.merged:")
        rels=c.get(BASE+"/relations",headers=EDITOR).json()["items"]
        assert rels[0]["status"]=="confirmed"
