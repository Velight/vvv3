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
    page.locator("#timeline").evaluate(
        "el=>{el.value=0;el.dispatchEvent(new Event('input',{bubbles:true}))}"
    )
    page.wait_for_function(
        "document.querySelector('.timeline-label').textContent.startsWith('Версия 1')"
    )
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
    page.get_by_role("button", name="Воспроизвести историю").click()
    page.wait_for_function(
        "document.querySelector('.timeline-label').textContent.startsWith('Версия 1')"
    )
    page.wait_for_function(
        "document.querySelector('.timeline-label').textContent.startsWith('Версия 3')",
        timeout=8000,
    )
    page.get_by_role("button", name="Приостановить историю").click()
    page.wait_for_timeout(500)
    value = page.locator("#timeline").input_value()
    page.wait_for_timeout(1400)
    assert page.locator("#timeline").input_value() == value
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
    assert not errors, errors
    b.close()
    print(
        "PASS: live input, latest selection, node identity, read-only history, playback/pause, reduced motion, mobile"
    )
