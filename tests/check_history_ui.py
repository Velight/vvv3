"""Run against a fresh seeded server; requires Playwright and Chromium."""

import os
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1536, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "sessionStorage.setItem('krok_api_key',"
        + __import__("json").dumps(os.environ.get("TEST_API_KEY", "local-demo"))
        + ")"
    )
    page.goto(os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8765"))
    page.locator("[data-client=krasnodar]").click()
    page.locator(".graph .person").first.wait_for()
    assert page.locator(".graph .person").count() == 10
    assert page.locator("#timeline").get_attribute("max") == "8"
    page.evaluate(
        "window.originalSlider=document.querySelector('#timeline');window.originalGraph=document.querySelector('.graph')"
    )
    # Caption and accessible value follow the slider synchronously, even
    # before the debounced request for the selected snapshot has returned.
    previews = page.locator("#timeline").evaluate("""el => {
        return [6, 3].map(index => {
            el.value = index;
            el.dispatchEvent(new Event('input', {bubbles: true}));
            const label = document.querySelector('.timeline-label').textContent;
            return {label, aria: el.getAttribute('aria-valuetext')};
        });
    }""")
    for result, version, day in zip(previews, [7, 4], [25, 22]):
        expected = page.evaluate(
            """day => new Date('2026-11-' + day + 'T10:00:00+03:00')
                .toLocaleString('ru-RU', {dateStyle:'medium',timeStyle:'short'})""",
            day,
        )
        assert result["label"].startswith(f"Версия {version} ·")
        assert expected in result["label"]
        assert result["aria"] == result["label"]
    page.locator("#timeline").evaluate(
        "el=>{el.value=0;el.dispatchEvent(new Event('input',{bubbles:true}))}"
    )
    page.wait_for_function(
        "document.querySelector('.timeline-label').textContent.startsWith('Версия 1')"
    )
    page.wait_for_function("!historyPending && state.graph.version === 1")
    assert page.locator(".graph .person").count() == 6
    assert page.get_by_role("button", name="Предложить правку").is_disabled()
    assert page.evaluate(
        "originalSlider===document.querySelector('#timeline')&&originalGraph===document.querySelector('.graph')"
    )
    page.locator("#timeline").evaluate(
        "el=>{for(const v of [7,1,5,2,8]){el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}))}}"
    )
    page.wait_for_function(
        "document.querySelector('.timeline-label').textContent.startsWith('Текущая версия')"
    )
    page.wait_for_function("!historyPending && state.graph.version === 9")
    assert page.locator('[data-action="play-history"]').count() == 0
    page.get_by_role("button", name="Предыдущая версия").click()
    page.wait_for_function("!historyPending && state.graph.version === 8")
    page.emulate_media(reduced_motion="reduce")
    page.get_by_role("button", name="Следующая версия").click()
    page.wait_for_timeout(500)
    assert (
        page.locator(".graph .person").first.evaluate(
            "e=>getComputedStyle(e).transitionDuration"
        )
        == "0s"
    )
    page.set_viewport_size({"width": 390, "height": 844})
    # Empty S7 map: caption is outside and below the graph viewport.
    # Dialog close glyph is geometrically centered on desktop and mobile.
    for width, height in [(390, 844), (1536, 900)]:
        page.set_viewport_size({"width": width, "height": height})
        if width < 701:
            page.locator(".mobile-back-link").click()
        else:
            page.locator('#dock [data-action="map"]').click()
        page.locator('[data-client="s7"]').click()
        page.locator(".empty-map").wait_for()
        assert page.locator('[data-action="play-history"]').count() == 0
        assert page.locator("#timeline").is_disabled()
        graph = page.locator("#graph-content").bounding_box()
        caption = page.locator(".empty-map").bounding_box()
        assert caption["y"] >= graph["y"] + graph["height"] - 1
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        if width < 701:
            page.locator(".mobile-back-link").click()
        page.locator('#dock [data-action="settings"]').click()
        page.locator('[data-action="mg-key"]').click()
        page.locator("#dialog[open]").wait_for()
        page.wait_for_function("document.querySelector('#dialog').getAnimations().every(a => a.playState === 'finished')")
        close = page.locator(".dialog-head [data-close]")
        button = close.bounding_box()
        icon = close.locator("svg").bounding_box()
        for axis, size in [("x", "width"), ("y", "height")]:
            assert abs(button[axis] + button[size]/2 - icon[axis] - icon[size]/2) < 1
        close.click()
        page.locator("#dialog").wait_for(state="hidden")
    assert not errors, errors
    b.close()
    print(
        "PASS: live input, latest selection, node identity, read-only history, manual navigation, reduced motion, empty state and centered close icon"
    )
