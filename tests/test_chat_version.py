from fastapi.testclient import TestClient
from app.main import create_app
from app.ai import AI

def test_assistant_uses_selected_map_version(tmp_path):
    keys={'key':{'user_id':'e','role':'editor','clients':['*']}}
    with TestClient(create_app(tmp_path/'test.db',keys=keys,ai=AI(),run_worker=False),headers={'X-API-Key':'key'}) as c:
        base='/api/v1/clients/krasnodar'
        r=c.patch(base+'/people/krasnodar-p1',json={'expected_version':1,'changes':{'name':'Новое имя'}})
        assert r.status_code == 200
        old=c.post(base+'/chat',json={'message':'Обзор','version':1}).json()
        assert old['context_version']==1
        assert 'Новое имя' not in old['answer']
        current=c.post(base+'/chat',json={'message':'Обзор'}).json()
        assert current['context_version']==2
        assert 'Новое имя' in current['answer']
