"""Browser regression: provenance belongs to the selected fact and revision."""
import json
import os
from playwright.sync_api import sync_playwright

base = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")
key = os.environ.get("TEST_API_KEY", "local-demo")
with sync_playwright() as p:
    browser = p.chromium.launch()
    for width, height in [(1536, 900), (390, 844)]:
        page = browser.new_page(viewport={"width": width, "height": height})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.add_init_script("sessionStorage.setItem('krok_api_key'," + json.dumps(key) + ")")
        page.goto(base)
        page.locator('[data-client="krasnodar"]').click()
        page.locator(".graph .person").first.wait_for()
        if width < 701:
            page.locator('[data-action="mobile-list"]').click()
            page.locator('[data-mobile-person="krasnodar-p2"]').click()
        else:
            page.locator('.graph [data-person="krasnodar-p2"]').click()
        page.wait_for_function("state.detail?.person?.id === 'krasnodar-p2' && state.detail.version === 9")
        panel = page.locator("#contact-panel")
        confirmed = panel.locator('[data-fact-id="krasnodar-story-link-1"]')
        proposed = panel.locator('[data-fact-id="krasnodar-r1"]')
        assert confirmed.locator(".fact-status.confirmed").inner_text() == "Подтверждено"
        assert proposed.locator(".fact-status.proposed").inner_text() == "Требует подтверждения"
        source = confirmed.locator(".fact-source")
        assert "Демо: этап 2" in source.inner_text()
        assert "21" in source.inner_text()
        source.click()
        page.locator("#dialog-content details").first.wait_for()
        assert "Источники версии 9" in page.locator("#dialog-content").inner_text()
        assert "Ирина Кузнецова" in page.locator("#dialog-content blockquote").first.inner_text()
        page.get_by_role("button", name="Закрыть", exact=True).click()
        panel.locator('[data-action="crm-record"]').click()
        assert "krasnodar-p2" in page.locator("#dialog-content").inner_text()
        page.get_by_role("button", name="Закрыть", exact=True).click()
        if width >= 701:
            page.screenshot(path="ui-capture/18-contact-provenance.png")
        else:
            page.screenshot(path="ui-capture/19-mobile-contact-provenance.png")
        page.locator("#timeline").evaluate("el=>{el.value=0;el.dispatchEvent(new Event('input',{bubbles:true}))}")
        page.wait_for_function("!historyPending && state.detail?.version === 1")
        assert panel.locator('[data-fact-id="krasnodar-story-link-1"]').count() == 0
        assert panel.get_by_role("button", name="Предложить правку").is_disabled()
        assert panel.locator('[data-fact-id="krasnodar-r1"] .fact-source').count() == 1
        panel.locator('[data-fact-id="krasnodar-r1"] .fact-source').click()
        page.locator("#dialog-content details").first.wait_for()
        assert "Источники версии 1" in page.locator("#dialog-content").inner_text()
        assert not errors, errors
        page.close()
    browser.close()
