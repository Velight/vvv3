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


def test_public_mcp_live_demo_and_no_auth(tmp_path):
    keys = {'editor': {'user_id': 'e', 'role': 'editor', 'clients': ['*']}}
    app = create_app(tmp_path/'private.db', keys=keys, seed_demo=False, run_worker=False)
    from app.models import ClientState
    from app.seed import seed
    seed(app.state.store)
    app.state.store.create(ClientState(id='private-only', name='Private customer', industry='Private', crm_id='private-crm'), 'e')
    headers = {'Accept': 'application/json, text/event-stream'}
    with TestClient(app, base_url='https://vvv3.onrender.com') as c:
        def call(method, params, endpoint='/mcp-demo/', extra=None):
            return c.post(endpoint, headers={**headers, **(extra or {})},
                          json={'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params})
        init = call('initialize', {'protocolVersion': '2025-03-26', 'capabilities': {}, 'clientInfo': {'name':'test', 'version':'1'}})
        assert init.status_code == 200
        assert 'live presentation demo' in str(init.json()).lower()
        tools = call('tools/list', {}).json()['result']['tools']
        assert len(tools) == 8
        assert all(t['annotations']['readOnlyHint'] for t in tools)
        data = call('tools/call', {'name':'list_clients', 'arguments':{}}).json()['result']
        assert not data['isError']
        assert 'krasnodar' in str(data) and 'private-only' not in str(data)
        for name in ('get_client_map', 'get_client_history', 'get_client_context', 'list_sources'):
            denied = call('tools/call', {'name': name, 'arguments': {'client_id':'private-only'}},
                          extra={'Authorization':'Bearer editor'}).json()['result']
            assert denied['isError']
        graph = call('tools/call', {'name':'get_client_map', 'arguments':{'client_id':'krasnodar'}}).json()['result']
        assert not graph['isError']
        app.state.store.mutate('krasnodar', 1, 'e', 'test.live', lambda s: setattr(s.people[0], 'name', 'Updated live contact'))
        updated = call('tools/call', {'name':'get_contact', 'arguments':{'client_id':'krasnodar', 'person_id':'krasnodar-p1'}}).json()['result']
        assert not updated['isError'] and 'Updated live contact' in str(updated)
        history = call('tools/call', {'name':'get_client_history', 'arguments':{'client_id':'krasnodar'}}).json()['result']
        assert not history['isError'] and 'test.live' in str(history)
        assert call('tools/list', {}, endpoint='/mcp/').status_code == 401
        assert c.get('/api/v1/clients').status_code == 401
