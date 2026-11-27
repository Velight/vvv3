"""Verify the proposal diff and review workflow in the existing map UI."""
import json
import os
from playwright.sync_api import sync_playwright

base=os.environ.get("TEST_BASE_URL","http://127.0.0.1:8000")
key=os.environ.get("TEST_API_KEY","local-demo")
with sync_playwright() as p:
    browser=p.chromium.launch()
    page=browser.new_page(viewport={"width":1536,"height":900},reduced_motion="reduce")
    errors=[]
    page.on("pageerror",lambda e: errors.append(str(e)))
    page.add_init_script("sessionStorage.setItem('krok_api_key',"+json.dumps(key)+")")
    page.goto(base)
    page.locator('[data-client="krasnodar"]').click()
    page.locator(".graph .person").first.wait_for()
    page.locator('#assistant-panel [data-action="proposals"]').click()
    page.locator(".proposal-row").first.click()
    assert page.locator(".proposal-minus").count()>0
    assert page.locator(".proposal-plus").count()>0
    assert "Согласует требования ИБ" in page.locator(".proposal-plus").all_text_contents()[0]
    assert "Демо-агент" not in page.locator("#dialog-content").inner_text()
    assert not any("Подтверждено" in value for value in page.locator(".proposal-plus").all_text_contents())
    assert page.locator(".proposal-evidence blockquote").count()>0
    page.screenshot(path="ui-capture/22-crm-proposal.png")
    page.locator('.dialog-head [data-close]').click()
    page.locator(".graph .person").first.click()
    page.get_by_role("button",name="Предложить правку").click()
    page.locator('input[name="title"]').fill("Тестовая новая должность")
    page.get_by_role("button",name="Создать предложение").click()
    page.locator(".proposal-row").filter(has_text="Правка:").first.click()
    assert "Тестовая новая должность" in page.locator(".proposal-plus").inner_text()
    assert page.evaluate("state.graph.version") == 9
    # Reject the UI-created proposal, leaving the seeded map intact for other tests.
    page.get_by_role("button",name="Отклонить",exact=True).click()
    page.locator(".proposal-row").filter(has_text="Правка:").first.wait_for()
    assert page.locator(".proposal-row").filter(has_text="Правка:").first.locator(".proposal-status").inner_text()=="Отклонено"
    assert page.evaluate("state.graph.version") == 9
    assert not errors,errors
    browser.close()
