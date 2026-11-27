"""Motion regression: stable switch nodes, short transitions and reduced motion."""
import json
import os
from playwright.sync_api import sync_playwright

base = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")
key = os.environ.get("TEST_API_KEY", "local-demo")
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 390, "height": 844})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script("sessionStorage.setItem('krok_api_key'," + json.dumps(key) + ")")
    page.goto(base)
    page.locator(".client-card").first.wait_for()
    page.locator('#dock [data-action="settings"]').click()
    switch = page.get_by_role("switch", name="Показывать только проверенные связи")
    switch.wait_for()
    initial = switch.get_attribute("aria-checked")
    switch.evaluate("el=>window.originalSwitch=el")
    switch.click()
    assert switch.get_attribute("aria-checked") != initial
    assert switch.evaluate("el=>el===window.originalSwitch")
    assert switch.locator("span").evaluate("el=>getComputedStyle(el).transitionDuration") == "0.19s"
    switch.click()
    assert switch.get_attribute("aria-checked") == initial
    page.locator('#dock [data-action="map"]').click()
    page.locator('[data-client="krasnodar"]').click()
    person = page.locator(".graph .person").first
    person.wait_for()
    assert person.evaluate("el=>getComputedStyle(el).transitionProperty") == "opacity"
    # Retarget before the previous motion completes. Every live line endpoint
    # must stay attached to the center of the corresponding live node.
    page.evaluate("""() => {
        window.motionErrors = [];
        window.sampleMotion = true;
        function sample(){
            if(!window.sampleMotion)return;
            for(const line of document.querySelectorAll('.graph [data-edge]')){
                const edge=state.graph.edges.find(e=>e.id===line.dataset.edge);
                if(!edge)continue;
                for(const [id,x,y] of [[edge.source,'x1','y1'],[edge.target,'x2','y2']]){
                    const node=[...document.querySelectorAll('.graph [data-person]')].find(n=>n.dataset.person===id);
                    if(!node)continue;
                    const m=node.transform.baseVal.getItem(0).matrix;
                    if(Math.abs(m.e+57-Number(line.getAttribute(x)))>.05 ||
                       Math.abs(m.f+18-Number(line.getAttribute(y)))>.05)window.motionErrors.push(id);
                }
            }
            requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
    }""")
    page.evaluate("setVersion(0)")
    page.wait_for_function("!historyPending && state.graph.version===1")
    page.evaluate("setVersion(8)")
    page.wait_for_function("!historyPending && state.graph.version===9 && graphFrame===0")
    assert page.evaluate("window.sampleMotion=false;window.motionErrors.length") == 0
    page.locator('[data-action="zoom-out"]').click()
    page.wait_for_function("zoomFrame===0 && mobileZoom===1.25")
    page.locator('[data-action="mobile-assistant"]').click()
    page.locator("#assistant-panel").wait_for()
    assert page.locator("#assistant-panel").evaluate("el=>getComputedStyle(el).transitionDuration").startswith("0.21s")
    page.locator("#assistant-panel .panel-heading button").click()
    page.locator("#assistant-panel").wait_for(state="hidden")
    page.emulate_media(reduced_motion="reduce")
    assert person.evaluate("el=>getComputedStyle(el).transitionDuration") == "0s"
    page.locator('[data-action="mobile-assistant"]').click()
    assert page.locator("#assistant-panel").evaluate("el=>getComputedStyle(el).animationName") == "none"
    assert not errors, errors
    browser.close()
