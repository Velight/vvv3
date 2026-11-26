import json
import pytest
from app.ai import AI, grounded_facts

CTX = {'people': [{'id':'p1','name':'Анна','department':'Закупки'}], 'relations':[]}

def test_selected_facts_are_rendered_verbatim(monkeypatch):
    ai = AI('http://localhost:11434/v1', 'test')
    monkeypatch.setattr(ai, 'complete', lambda system, payload, schema: json.dumps({'facts':[next(f['id'] for f in payload['facts'] if f['text'] == 'Анна. Отдел: Закупки')]*2}))
    assert ai.answer('Кто занимается закупками?', CTX, []) == 'Анна. Отдел: Закупки'

def test_invalid_references_rejected(monkeypatch):
    ai = AI('http://localhost:11434/v1', 'test')
    monkeypatch.setattr(ai, 'complete', lambda *a: '{"facts":[999]}')
    with pytest.raises(ValueError):
        ai.answer('Кто?', CTX, [])

def test_count_and_missing_answer(monkeypatch):
    ai = AI('http://localhost:11434/v1', 'test')
    monkeypatch.setattr(ai, 'complete', lambda *a: '{"facts":[]}')
    assert ai.answer('Сколько контактов?', CTX, []).endswith('1.')
    assert 'нет ответа' in ai.answer('Какой доход?', CTX, [])

def test_relation_status_and_direction():
    ctx = {**CTX, 'relations':[{'from_person_id':'p1','to_person_id':'p2','kind':'reports_to','status':'proposed','evidence':[{'source_id':'s1'}]}]}
    fact = grounded_facts(ctx)[-1]
    assert 'Анна → p2: подчиняется' in fact
    assert 'предположение, не подтверждено' in fact
    assert 's1' in fact

def test_site_help_and_current_screen():
    ai = AI('http://localhost:11434/v1', 'test')
    assert 'Перетаскивайте' in ai.answer('Как посмотреть историю изменений?', CTX, [])
    assert '.txt' in ai.answer('Как загрузить протокол?', CTX, [])
    assert 'редактора' in ai.answer('Как редактировать контакт?', CTX, [])
    assert 'Клиент' in ai.answer('Где я сейчас?', {**CTX,'client':{'name':'Тест','version':2},'scope':'client'}, [])

def test_mcp_help_is_not_mistaken_for_login():
    ai = AI()
    assert '/mcp/' in ai.answer('Как подключить своего агента по MCP?', CTX, [])
