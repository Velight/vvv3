"""Browser smoke test against a seeded server (no model required)."""
import json
import os
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width':1536,'height':900})
    errors = []
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.add_init_script("sessionStorage.setItem('krok_api_key',"+json.dumps(os.getenv('TEST_API_KEY','local-demo'))+")")
    page.goto(os.getenv('TEST_BASE_URL','http://127.0.0.1:8765'))
    page.locator('[data-client=krasnodar]').click()
    page.locator('.graph .person').first.wait_for()
    page.get_by_role('button',name='Сводка',exact=True).click()
    page.wait_for_function("document.querySelector('.chat-log').textContent.includes('Контактов: 10.')")
    assert 'Автоматическая аналитика' in page.locator('.chat-log').inner_text()
    page.get_by_role('button',name='Рекомендации',exact=True).click()
    page.wait_for_function("document.querySelector('.chat-log').textContent.includes('Непроверенных связей:')")
    page.get_by_role('button',name='Сравнить версии',exact=True).click()
    page.locator('select[name=compare_version]').select_option('1')
    page.get_by_role('button',name='Сравнить',exact=True).click()
    page.wait_for_function("document.querySelector('.chat-log').textContent.includes('Сравнение версий 1 → 9')")
    page.locator('#timeline').evaluate("el=>{el.value=0;el.dispatchEvent(new Event('input',{bubbles:true}))}")
    page.wait_for_function("document.querySelector('.timeline-label').textContent.startsWith('Версия 1')")
    page.get_by_role('button',name='Сводка',exact=True).click()
    page.wait_for_function("document.querySelector('.chat-log').textContent.includes('Контактов: 6.')")
    assert 'Контактов: 10.' not in page.locator('.chat-log').inner_text()
    assert page.get_by_role('button',name='Предложить правку').is_disabled()
    page.get_by_role('button',name='Подключить своего агента').click()
    page.wait_for_function("document.querySelector('#agent-status').textContent.startsWith('MCP доступен')")
    assert 'Подключение агента не проверено' in page.locator('#agent-status').inner_text()
    for value in ['codex','claude','custom']:
        page.locator('#agent-client').select_option(value)
        assert page.locator('#agent-instructions').inner_text()
        assert os.getenv('TEST_API_KEY','local-demo') not in page.locator('#dialog-content').inner_text()
    page.route('**/mcp/',lambda route:route.fulfill(status=401,json={'detail':'Unauthorized'}))
    page.get_by_role('button',name='Проверить сервер',exact=True).click()
    page.wait_for_function("document.querySelector('#agent-status').textContent.includes('401')")
    page.get_by_role('button',name='Закрыть',exact=True).click()
    page.set_viewport_size({'width':390,'height':844})
    assert page.get_by_role('button',name='Подключить своего агента').is_visible()
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    if os.getenv('COPILOT_SCREENSHOT'):
        page.screenshot(path=os.environ['COPILOT_SCREENSHOT'],full_page=True)
    assert not errors,errors
    browser.close()
    print('PASS: summary, recommendations, comparison, historical context, MCP availability/auth failure, mobile')
