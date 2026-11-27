import httpx
import pytest
from fastapi.testclient import TestClient
from app.ai import AI
from app.main import create_app

BASE = '/api/v1/clients/krasnodar'
KEYS = {'editor': {'user_id': 'e', 'role': 'editor', 'clients': ['*']},
        'viewer': {'user_id': 'v', 'role': 'viewer', 'clients': ['krasnodar']}}


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path/'test.db', keys=KEYS, ai=AI(), run_worker=False),
                    headers={'X-API-Key': 'viewer'}) as c:
        yield c


def test_analytics_uses_database_without_model(client, monkeypatch):
    calls = []
    def forbidden(*args, **kwargs):
        calls.append(True)
        raise AssertionError('LLM must not be called')
    monkeypatch.setattr(AI, 'complete', forbidden)
    initial = client.get(BASE+'/map').json()
    summary = client.post(BASE+'/chat', json={'message': 'Сводка', 'intent': 'summary'}).json()
    assert summary['mode'] == 'analytics'
    assert 'Автоматическая аналитика' in summary['answer']
    assert 'Контактов: 6. ЛПР: 3. Сделок: 1.' in summary['answer']
    recommendations = client.post(BASE+'/chat', json={'message': 'Что проверить?', 'intent': 'recommendations'}).json()
    assert 'Непроверенных связей: 1' in recommendations['answer']
    assert 'krasnodar-source' in recommendations['answer']
    assert 'канал связи' in recommendations['answer']
    assert client.get(BASE+'/map').json() == initial
    assert len(client.get(BASE+'/history').json()['items']) == 1
    assert not calls
    assert client.post('/api/v1/clients/vtb/chat',json={'message':'Сводка'}).status_code == 404
    assert client.post(BASE+'/chat',json={'message':'Сводка'},headers={'X-API-Key':'bad'}).status_code == 401


def test_comparison_uses_exact_versions_and_status(client):
    r = client.patch(BASE+'/relations/krasnodar-r1/review', headers={'X-API-Key':'editor'},
                     json={'expected_version':1, 'status':'confirmed'})
    assert r.status_code == 200
    r = client.patch(BASE+'/people/krasnodar-p1', headers={'X-API-Key':'editor'},
                     json={'expected_version':2,'changes':{'title':'Новая должность','relationship':'weak'}})
    assert r.status_code == 200
    result = client.post(BASE+'/chat', json={'message':'Сравни версии 1 и 3'}).json()
    assert result['context_version'] == 3 and result['compare_version'] == 1
    assert 'не проверено → подтверждено' in result['answer']
    assert 'Новая должность' in result['answer']
    assert 'устойчивые → слабые' in result['answer']
    old = client.post(BASE+'/chat', json={'message':'Сравнить','intent':'compare','version':2,'compare_version':1}).json()
    assert 'Новая должность' not in old['answer']
    assert old['context_version'] == 2
    assert client.post(BASE+'/chat',json={'message':'Сравни 1 и 999'}).status_code == 404
    assert client.post(BASE+'/chat',json={'message':'Сравни 0 и 2'}).status_code == 422


def test_empty_and_first_version(client):
    first = client.post(BASE+'/chat',json={'message':'Сравнить','intent':'compare'}).json()
    assert 'первая сохранённая версия' in first['answer']
    empty = client.post('/api/v1/clients/s7/chat',headers={'X-API-Key':'editor'},
                        json={'message':'Сводка','intent':'summary'}).json()
    assert 'Контактов: 0' in empty['answer']
    assert 'Взаимодействия не зафиксированы' in empty['answer']
    help_result = client.post(BASE+'/chat',json={'message':'Помощь','intent':'help'}).json()
    assert 'Подключить своего агента' in help_result['answer']


def test_unavailable_model_falls_back_and_does_not_leak(tmp_path, monkeypatch):
    ai = AI('http://127.0.0.1:1/v1','missing-model','secret-not-for-output')
    def offline(*args, **kwargs):
        raise httpx.ConnectError('secret-not-for-output')
    monkeypatch.setattr(ai, 'complete', offline)
    with TestClient(create_app(tmp_path/'db',keys=KEYS,ai=ai,run_worker=False),headers={'X-API-Key':'viewer'}) as c:
        r = c.post(BASE+'/chat',json={'message':'Телефон Николая Орлова?'})
        assert r.status_code == 200
        assert r.json()['mode'] == 'analytics'
        assert 'Модель недоступна' in r.json()['answer']
        assert 'secret-not-for-output' not in r.text
        assert c.get('/health').status_code == 200
