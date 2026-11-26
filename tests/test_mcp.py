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
