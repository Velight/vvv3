"""Check mobile-only navigation and selected contact contrast in every map scope."""
import json
import os
from playwright.sync_api import sync_playwright

base = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")
key = os.environ.get("TEST_API_KEY", "local-demo")
with sync_playwright() as p:
    browser = p.chromium.launch()
    for width, height in [(390, 844), (1536, 900)]:
        page = browser.new_page(viewport={"width": width, "height": height}, reduced_motion="reduce")
        page.add_init_script("sessionStorage.setItem('krok_api_key'," + json.dumps(key) + ")")
        page.goto(base)
        page.locator(".client-card").first.wait_for()
        assert page.locator("#dock").is_visible()
        for screen in ("sources", "settings"):
            page.locator('#dock [data-action="'+screen+'"]').click()
            page.locator(".management-screen").wait_for()
            assert page.locator("#dock").is_visible()
        page.locator('#dock [data-action="map"]').click()
        page.locator('[data-client="krasnodar"]').click()
        page.locator(".graph .person").first.wait_for()
        mobile = width <= 700
        assert page.locator("#dock").is_visible() != mobile
        assert page.locator('.topbar > [data-action="map"]').is_visible() != mobile
        assert page.locator('.topbar > [data-action="next-client"]').is_visible() != mobile
        assert page.locator('[data-action="mobile-contact"]').count() == 0
        if mobile:
            assert page.locator(".mobile-back-link").is_visible()
            graph = page.locator("#graph-content").bounding_box()
            assert graph["height"] > height * .43
            tabs = page.locator(".topbar .segmented").bounding_box()
            assistant = page.locator('[data-action="mobile-assistant"]').bounding_box()
            assert tabs["y"] >= assistant["y"] + assistant["height"] - 1
            assert abs(assistant["x"] + assistant["width"]/2 - width/2) < 3
            page.locator('[data-action="mobile-list"]').click()
            assert page.locator('.mobile-person-choice.selected').count() == 1
            page.locator('[data-mobile-person="krasnodar-p2"]').click()
            assert page.locator("#contact-panel").is_visible()
            page.locator("#contact-panel .panel-heading button").click()
        else:
            page.locator('.graph [data-person="krasnodar-p2"]').click()
        page.wait_for_function("""() => {
            const node = document.querySelector('.graph [data-person="krasnodar-p2"]');
            return node?.classList.contains('selected') &&
                getComputedStyle(node.querySelector('.person-card')).fill === 'rgb(8, 125, 81)';
        }""")
        selected = page.locator(".graph .person.selected")
        assert selected.count() == 1
        assert selected.get_attribute("aria-pressed") == "true"
        assert selected.locator(".node-name").evaluate("e => getComputedStyle(e).fill") == "rgb(255, 255, 255)"
        assert selected.locator(".avatar-bg").evaluate("e => getComputedStyle(e).fill") == "rgb(255, 255, 255)"
        for scope in ("deal", "person", "client"):
            page.locator('.segmented [data-scope="'+scope+'"]').click()
            page.wait_for_function("scope => state.graph.scope === scope", arg=scope)
            assert page.locator(".graph .person.selected").count() == 1
            page.wait_for_function("""() => getComputedStyle(document.querySelector('.graph .person.selected .person-card')).fill === 'rgb(8, 125, 81)'""")
            assert page.locator("#dock").is_visible() != mobile
        page.locator("#timeline").evaluate("el=>{el.value=0;el.dispatchEvent(new Event('input',{bubbles:true}))}")
        page.wait_for_function("!historyPending && state.graph.version === 1")
        assert page.locator(".graph .person.selected").count() == 1
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        if mobile:
            page.screenshot(path="ui-capture/20-mobile-map-navigation.png", full_page=True)
            page.locator(".mobile-back-link").click()
            page.locator(".client-card").first.wait_for()
            assert page.locator("#dock").is_visible()
        else:
            page.screenshot(path="ui-capture/21-selected-contact.png")
        page.close()
    browser.close()
