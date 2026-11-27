import json
from fastapi.testclient import TestClient
from app.main import create_app


def test_mcp_auth_and_client_isolation(tmp_path):
    keys = {'limited': {'user_id': 'v', 'role': 'viewer', 'clients': ['krasnodar']}}
    with TestClient(create_app(tmp_path/'db', keys=keys, run_worker=False), base_url='http://localhost') as c:
        def call(method, params, token='limited'):
            return c.post('/mcp/', headers={'Authorization': 'Bearer '+token, 'Accept': 'application/json, text/event-stream'},
                          json={'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params})
        assert call('tools/list', {}, 'invalid').status_code == 401
        init = call('initialize', {'protocolVersion': '2025-03-26', 'capabilities': {}, 'clientInfo': {'name': 'test', 'version': '1'}})
        assert init.status_code == 200
        tools = call('tools/list', {}).json()['result']['tools']
        assert len(tools) == 8
        assert all(t['annotations']['readOnlyHint'] for t in tools)
        r = call('tools/call', {'name': 'get_client_map', 'arguments': {'client_id': 'vtb'}}).json()['result']
        assert r['isError'] is True
        r = call('tools/call', {'name': 'get_client_history', 'arguments': {'client_id': 'krasnodar'}}).json()['result']
        assert r['isError'] is False
        r = call('tools/call', {'name': 'list_clients', 'arguments': {}}).json()['result']
        text = str(r)
        assert 'krasnodar' in text and 'vtb' not in text

        help_result = call('tools/call', {'name':'get_site_help', 'arguments':{'topic':'history'}}).json()['result']
        assert help_result['isError'] is False
        assert 'ползунок' in str(help_result)
        assert call('tools/call', {'name':'list_sources', 'arguments':{'client_id':'vtb'}}).json()['result']['isError'] is True


def test_all_eight_tools_work_without_llama_and_enforce_acl(tmp_path, monkeypatch):
    from app.ai import AI
    ai = AI('http://127.0.0.1:1/v1', 'unavailable')
    def forbidden(*args, **kwargs):
        raise AssertionError('MCP must never call an LLM')
    monkeypatch.setattr(ai, 'complete', forbidden)
    keys = {'limited': {'user_id': 'v', 'role': 'viewer', 'clients': ['krasnodar']}}
    with TestClient(create_app(tmp_path/'db', keys=keys, ai=ai, run_worker=False), base_url='http://localhost') as c:
        def call(name, arguments, token='limited'):
            return c.post('/mcp/',headers={'Authorization':'Bearer '+token,'Accept':'application/json, text/event-stream'},
                json={'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':name,'arguments':arguments}})
        cases = {
            'list_clients': {},
            'get_client_map': {'client_id':'krasnodar','version':1},
            'get_contact': {'client_id':'krasnodar','person_id':'krasnodar-p1','version':1},
            'get_client_history': {'client_id':'krasnodar'},
            'get_client_context': {'client_id':'krasnodar','version':1},
            'get_source': {'client_id':'krasnodar','source_id':'krasnodar-source'},
            'list_sources': {'client_id':'krasnodar'},
            'get_site_help': {'topic':'mcp'},
        }
        for name, arguments in cases.items():
            assert call(name,arguments).json()['result']['isError'] is False, name
            assert call(name,arguments,token='bad').status_code == 401
            if 'client_id' in arguments:
                blocked = call(name,{**arguments,'client_id':'vtb'}).json()['result']
                assert blocked['isError'] is True, name
                assert 'Николай' not in str(blocked)
        assert call('delete_client',{'client_id':'krasnodar'}).json()['result']['isError'] is True
        assert call('list_clients',{'limit':201}).json()['result']['isError'] is True
        assert call('get_client_map',{'client_id':'krasnodar','version':999}).json()['result']['isError'] is True
        assert call('get_contact',{'client_id':'krasnodar','person_id':'vtb-p1'}).json()['result']['isError'] is True
        assert call('get_source',{'client_id':'krasnodar','source_id':'vtb-source'}).json()['result']['isError'] is True
        assert len(json.loads(call('get_client_history',{'client_id':'krasnodar'}).json()['result']['content'][0]['text'])['items']) == 1
        unauthenticated = c.post('/mcp/',json={'jsonrpc':'2.0','id':1,'method':'tools/list'},headers={'Accept':'application/json, text/event-stream'})
        assert unauthenticated.status_code == 401
