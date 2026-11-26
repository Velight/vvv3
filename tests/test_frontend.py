from pathlib import Path
import re
from fastapi.testclient import TestClient
from app.main import create_app
from app.ai import process_job, AI

KEYS = {'editor': {'user_id': 'e', 'role': 'editor', 'clients': ['*']},
        'viewer': {'user_id': 'v', 'role': 'viewer', 'clients': ['krasnodar']}}
BASE = '/api/v1/clients/krasnodar'


def test_frontend_and_assets_do_not_expose_server_files(tmp_path):
    with TestClient(create_app(tmp_path/'test.db', keys=KEYS, run_worker=False)) as c:
        assert c.get('/').status_code == 200
        assert 'src="/app.js"' in c.get('/').text
        assert c.get('/api/v1/clients').status_code == 401
        assert c.get('/api/v1/missing').status_code == 404
        for path in ('/.env', '/app/main.py', '/data/krok.db', '/.git/config'):
            assert c.get(path).status_code == 404
        root = Path(__file__).resolve().parents[1] / 'frontend'
        used = set()
        for name in ('app.js', 'logos.js', 'styles.css'):
            text = (root / name).read_text()
            used.update(re.findall(r"[\"'/]([a-f0-9]+\.svg)", text))
            used.update(re.findall(r'(mulish-\d+\.ttf)', text))
        for file in used:
            assert (root/'assets'/file).stat().st_size > 0, file
            assert c.get('/assets/'+file).status_code == 200, file


def test_browser_integration_contract(tmp_path):
    app = create_app(tmp_path/'test.db', keys=KEYS, run_worker=False)
    with TestClient(app, headers={'X-API-Key': 'editor'}) as c:
        assert c.get('/api/v1/me').json()['role'] == 'editor'
        initial = c.get(BASE+'/map').json()
        saved = c.post(BASE+'/sources?expected_version=1', json={
            'title': 'Протокол', 'kind': 'protocol',
            'text': 'Николай Орлов и Ирина Кузнецова согласуют требования.',
            'source_date': '2026-11-26T12:00:00+03:00',
        })
        assert saved.status_code == 201
        source_id = saved.json()['item']['id']
        job = c.post(BASE+'/sources/'+source_id+'/process').json()
        process_job(app.state.store, AI('', '', ''), app.state.store.claim_job())
        assert c.get('/api/v1/jobs/'+job['id']).json()['status'] == 'completed'
        latest = c.get(BASE+'/map').json()
        assert latest['version'] > saved.json()['version']
        assert c.get(BASE+'/map?version=1').json() == initial
        r = latest['edges'][-1]
        reviewed = c.patch(BASE+'/relations/'+r['id']+'/review', json={
            'expected_version': latest['version'], 'status': 'confirmed'})
        assert reviewed.status_code == 200
        assert c.patch(BASE+'/people/krasnodar-p1', json={
            'expected_version': 1, 'changes': {'name': 'Stale'}}).status_code == 409
        answer = c.post(BASE+'/chat', json={'message': 'Обзор', 'scope': 'client'}).json()
        assert answer['context_version'] == reviewed.json()['version']
        assert c.get(BASE+'/chat/sessions/'+answer['session_id']).json()['messages'] == answer['messages']
        for scope, sid in [('deal', 'krasnodar-d1'), ('person', 'krasnodar-p1')]:
            graph = c.get(BASE+'/map', params={'scope': scope, 'scope_id': sid})
            assert graph.status_code == 200
            assert graph.json()['scope'] == scope
        c.headers['X-API-Key'] = 'viewer'
        assert c.patch(BASE+'/people/krasnodar-p1', json={
            'expected_version': reviewed.json()['version'], 'changes': {'name': 'Forbidden'}}).status_code == 403
        assert c.get(BASE+'/chat/sessions/'+answer['session_id']).status_code == 404
