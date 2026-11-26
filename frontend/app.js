import { revealMap } from './motion.js';
import {
    Api
} from './api.js';
import {
    krasnodarLogo
} from './logos.js';
let historyTimer, historyController;
const historyCache = new Map();
const app = document.querySelector('#app'),
    dialog = document.querySelector('#dialog');
const api = new Api(sessionStorage.getItem('krok-key') || '');
const state = {
    user: null,
    client: null,
    graph: null,
    history: [],
    people: [],
    deals: [],
    scope: 'client',
    scopeId: null,
    version: null,
    collapsed: false,
    messages: [],
    sessionId: null,
    request: 0,
    chatRequest: 0,
    chatBusy: false,
    page: 0
};
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
} [c]));
const asset = (file, cls = '') => `<img src="/assets/${file}" alt="" class="${cls}">`;

function logo(id) {
    if (id === 'krasnodar') return krasnodarLogo;
    if (id === 'vtb') return asset('0aa4f.svg', 'logo-vtb');
    if (id === 'mvideo') return asset('85fea.svg', 'logo-mvideo');
    if (id === 's7') return `<div class="logo-s7">${asset('e2034.svg')}${asset('bb313.svg')}</div>`;
    return '';
}

function resize() {
    const scale = innerWidth / 3923;
    app.style.zoom = scale;
    app.style.transform = 'none';
    document.querySelector('#viewport').style.height = `${1960*scale}px`;
}
window.addEventListener('resize', resize);
resize();
let noticeTimer;

function notify(message) {
    const n = document.querySelector('#notice');
    n.textContent = message;
    n.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => n.hidden = true, 7000);
}

function nav(mode = '') {
    return `<nav class="nav panel ${mode}" aria-label="Главное меню">${[['clients','c8b30.svg','Клиенты'],['sources','62dee.svg','Источники'],['settings','4ce7a.svg','Настройки']].map(([action,img,label])=>`<button data-action="${action}" aria-label="${label}" title="${label}" class="${action==='clients'?'active':''}">${asset(img)}${mode==='vertical'?`<span>${label}</span>`:''}</button>`).join('')}</nav>`;
}

function showDialog(title, body, onSubmit) {
    dialog.innerHTML = `<form><h2>${esc(title)}</h2>${body}<p class="error" role="alert"></p><button type="button" data-close>Закрыть</button></form>`;
    dialog.querySelector('[data-close]').onclick = () => dialog.close();
    dialog.querySelector('form').onsubmit = async e => {
        e.preventDefault();
        if (!onSubmit) return;
        const buttons = [...dialog.querySelectorAll('button')];
        buttons.forEach(b => b.disabled = true);
        try {
            await onSubmit(new FormData(e.target));
        } catch (err) {
            dialog.querySelector('.error').textContent = err.message;
        } finally {
            buttons.forEach(b => b.disabled = false);
        }
    };
    if (!dialog.open) dialog.showModal();
}

function login() {
    app.innerHTML = `<form class="login panel"><h1>Карта контактов</h1><p>Введите ключ доступа к вашему рабочему пространству.</p><input name="key" type="password" placeholder="Ключ доступа" required autocomplete="off" aria-label="Ключ доступа"><button>Войти</button></form>`;
    app.querySelector('form').onsubmit = async e => {
        e.preventDefault();
        api.key = new FormData(e.target).get('key');
        try {
            state.user = await api.request('/me');
            sessionStorage.setItem('krok-key', api.key);
            await route();
        } catch (err) {
            api.key = '';
            notify(err.message);
        }
    };
}
async function route() {
    if (!state.user) return login();
    const match = location.hash.match(/^#\/clients\/([^/?]+)(?:\?(.*))?$/);
    if (match) {
        const p = new URLSearchParams(match[2] || '');
        await openClient(decodeURIComponent(match[1]), p.get('scope') || 'client', p.get('scope_id'));
    } else await clients();
}

function goHome() {
    if (location.hash === '#/clients') clients();
    else location.hash = '/clients';
}
async function clients() {
    const token = ++state.request;
    state.chatRequest++;
    state.client = null;
    state.chatBusy = false;
    app.innerHTML = nav('bottom') + '<p class="loading">Загрузка клиентов…</p>';
    try {
        const data = await api.request('/clients?offset=' + state.page * 4 + '&limit=4');
        if (token !== state.request) return;
        app.innerHTML = nav('bottom') + `<section class="cards" aria-label="Клиенты">${data.items.map(c=>`<button class="client-card panel" data-client="${esc(c.id)}"><h2>${esc(c.name)}</h2><span class="count">${c.contacts_count} ${plural(c.contacts_count,['контакт','контакта','контактов'])}</span><div class="updates">${asset('2628f.svg')}<span>${c.updates_count?c.updates_count+' '+plural(c.updates_count,['обновление','обновления','обновлений']):'Нет обновлений'}</span></div><div class="card-logo ${esc(c.id)}">${logo(c.id)}</div><div class="coverage">Охват ЛПР<span class="ratio">${c.coverage.ratio===null?'Нет данных':Math.round(c.coverage.ratio*100)+'%'}</span><div class="bar"><span style="width:${(c.coverage.ratio||0)*100}%"></span></div></div>${asset('df6ec.svg','card-arrow')}</button>`).join('')}</section>${data.total>4?`<div class="pages"><button data-action="prev" ${state.page===0?'disabled':''}>Назад</button><span>${state.page+1} / ${Math.ceil(data.total/4)}</span><button data-action="next" ${(state.page+1)*4>=data.total?'disabled':''}>Далее</button></div>`:''}${!data.items.length?'<p class="loading">Нет доступных клиентов</p>':''}`;
    } catch (err) {
        if (token === state.request) {
            app.innerHTML = nav('bottom') + `<p class="loading">${esc(err.message)} <button data-action="clients">Повторить</button></p>`;
        }
    }
}

function plural(n, forms) {
    return forms[n % 100 > 10 && n % 100 < 20 ? 2 : n % 10 === 1 ? 0 : n % 10 >= 2 && n % 10 <= 4 ? 1 : 2];
}
async function openClient(id, scope = 'client', scopeId = null) {
    const token = ++state.request;
    state.chatRequest++;
    state.chatBusy = false;
    app.innerHTML = nav() + '<p class="loading">Загрузка карты…</p>';
    try {
        const [c, p, d, h] = await Promise.all([api.get(id, ''), api.get(id, '/people'), api.get(id, '/deals'), api.get(id, '/history')]);
        if (token !== state.request) return;
        Object.assign(state, {
            client: c,
            people: p.items,
            deals: d.items,
            history: h.items,
            scope,
            scopeId,
            version: null,
            messages: [],
            sessionId: null
        });
        await loadMap(token);
        if (token === state.request) await loadChat();
    } catch (err) {
        if (token === state.request) app.innerHTML = nav() + `<p class="loading">${esc(err.message)} <button data-action="clients">К клиентам</button></p>`;
    }
}
async function loadMap(token = ++state.request) {
    const id = state.client.id;
    const g = await api.get(id, '/map', {
        scope: state.scope,
        scope_id: state.scopeId,
        version: state.version
    });
    if (token !== state.request) return;
    state.graph = g;
    renderMap();
    if (!state.version) {
        await api.write(id, '/read?version=' + g.version);
    }
}
const initials = name => {
    const a = name.split(' ');
    return a.length > 1 ? a[0][0] + '. ' + a.slice(1).join(' ') : name;
};

function renderMap(historyOnly = false) {
    const g = state.graph,
        c = state.client;
    const width = state.collapsed ? 3054 : 2753;
    const cx = width / 2,
        cy = 739;
    // The six original layout slots are retained for the supplied demo contacts; new data uses API coordinates.
    const slots = {
        p1: [-273.5, -58],
        p2: [165.5, 230],
        p3: [-533.5, -275],
        p4: [207.5, -377],
        p5: [582.5, -48],
        p6: [-383.5, 483]
    };
    const versions = state.history.map(h => h.version).sort((a, b) => a - b);
    const vi = Math.max(0, versions.indexOf(g.version));
    const angle = (vi - versions.length + 1) * 0.13;
    const positions = new Map(g.nodes.map(n => {
        const key = n.id.startsWith(c.id + '-') ? n.id.slice(c.id.length + 1) : '';
        const p = slots[key] || [n.position.x, n.position.y];
        return [n.id, [cx + p[0] * Math.cos(angle) - p[1] * Math.sin(angle), cy + p[0] * Math.sin(angle) + p[1] * Math.cos(angle)]];
    }));
    const progress = versions.length > 1 ? vi / (versions.length - 1) * 100 : 100;
    const markup = nav(state.collapsed ? 'vertical' : '') + `<aside class="assistant panel ${state.collapsed?'collapsed':''}"><header><span>Ассистент</span><button data-action="collapse" aria-label="${state.collapsed?'Развернуть':'Свернуть'} ассистента">${asset('3ee41.svg')}</button></header>${!state.collapsed?`<div class="messages" aria-live="polite"></div><form class="chat-form"><button type="button" data-action="upload" aria-label="Добавить источник" ${state.user.role!=='editor'?'disabled':''}>${asset('988ea.svg')}</button><input name="message" placeholder="Есть мысли?" aria-label="Сообщение ассистенту" maxlength="4000" required><button aria-label="Отправить" ${state.chatBusy?'disabled':''}>${asset('f64f8.svg','send')}</button></form>`:''}</aside><section class="map-panel panel ${state.collapsed?'wide':''}" aria-label="Карта связей"><h1>${esc(c.name)}</h1><div class="scope-switch" role="group" aria-label="Режим карты">${[['client','Клиент'],['deal','Сделка'],['person','Человек']].map(([s,t])=>`<button data-scope="${s}" class="${g.scope===s?'active':''}" aria-pressed="${g.scope===s}">${t}</button>`).join('')}</div><div class="graph-stage">${!g.empty?`${asset('649be.svg','rings')}<div class="graph-logo ${esc(c.id)}">${g.scope==='client'?logo(c.id):`<button class="scope-center" data-action="scope-detail">${esc(g.scope==='deal'?'Сделка':initials(g.nodes.find(n=>n.id===g.scope_id)?.data.name||'Контакт'))}</button>`}</div><svg class="edges" viewBox="0 0 ${width} 1390" aria-label="Связи">${g.edges.map(e=>{const a=positions.get(e.source),b=positions.get(e.target);return a&&b?`<g data-relation="${esc(e.id)}" tabindex="0" role="button" aria-label="${esc(e.data.description||'Основание связи')}"><line class="hit" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/><line class="${e.data.status}" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/></g>`:'';}).join('')}</svg>${g.nodes.map(n=>{const p=positions.get(n.id);return `<button class="person-node" data-person="${esc(n.id)}" style="left:${p[0]-145}px;top:${p[1]-50}px" aria-label="${esc(n.data.name+', '+n.data.title)}"><div class="avatar">${asset('4c565.svg')}${asset('5ea8d.svg')}</div><span>${esc(initials(n.data.name))}</span><small>${esc(n.data.department)}</small></button>`;}).join('')}`:`<p class="empty">Пока нет контактов</p>`}</div><div class="history"><label for="history">История изменений</label><small class="history-caption">${esc(historyCaption(g.version))}</small><input id="history" type="range" min="0" max="${Math.max(1,versions.length-1)}" value="${versions.length===1?1:vi}" style="--progress:${progress}%" aria-label="Версия карты" ${versions.length<2?'disabled':''}></div><button class="back" data-action="clients" aria-label="Назад к клиентам">${asset('0fa77.svg')}</button></section>`;
    if (historyOnly) {
        const fragment = document.createElement('div');
        fragment.innerHTML = markup;
        const stage = app.querySelector('.graph-stage');
        const next = fragment.querySelector('.graph-stage');
        const old = new Map([...stage.querySelectorAll('[data-person]')].map(n => [n.dataset.person, n]));
        next.querySelectorAll('[data-person]').forEach(n => {
            const previous = old.get(n.dataset.person);
            if (previous) {
                const x = parseFloat(previous.style.left) - parseFloat(n.style.left);
                const y = parseFloat(previous.style.top) - parseFloat(n.style.top);
                if (previous.textContent !== n.textContent) n.classList.add('history-changed');
                if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
                    n.animate([{
                        transform: `translate(${x}px,${y}px)`
                    }, {
                        transform: 'translate(0,0)'
                    }], {
                        duration: 350,
                        easing: 'cubic-bezier(.2,.8,.2,1)'
                    });
            }
        });
        stage.replaceChildren(...next.childNodes);
        app.querySelector('.history-caption').textContent = historyCaption(g.version);
        app.querySelector('.detail')?.remove();
        return;
    }
    app.innerHTML = markup;
    revealMap(app);
    const slider = document.querySelector('#history');
    slider.oninput = () => {
        const index = Number(slider.value);
        slider.style.setProperty('--progress', `${index / Math.max(1,versions.length-1)*100}%`);
        const version = versions[index];
        app.querySelector('.history-caption').textContent = historyCaption(version) + ' · загрузка…';
        // Keep this input in the DOM: replacing it would interrupt an active drag.
        clearTimeout(historyTimer);
        const token = ++state.request;
        historyController?.abort();
        historyTimer = setTimeout(() => scrubHistory(version, token), 60);
    };
    const f = document.querySelector('.chat-form');
    if (f) f.onsubmit = sendChat;
    renderMessages();
}

function renderMessages() {
    const el = document.querySelector('.messages');
    if (!el) return;
    el.innerHTML = state.messages.map(m => `<div class="message ${m.role==='user'?'user':'assistant-message'}">${esc(m.content)}</div>`).join('') + (state.chatBusy ? '<div class="message"><small>Ассистент отвечает<span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span></small></div>' : '');
    el.scrollTop = el.scrollHeight;
}
async function loadChat() {
    const token = ++state.chatRequest,
        id = state.client.id,
        scope = state.scope,
        scopeId = state.scopeId;
    state.messages = [];
    state.sessionId = null;
    renderMessages();
    try {
        const list = await api.get(id, '/chat/sessions');
        const session = list.items.find(s => s.scope === scope && (s.scope_id || null) === (scopeId || null));
        if (session) {
            const data = await api.get(id, '/chat/sessions/' + encodeURIComponent(session.id));
            if (token !== state.chatRequest) return;
            state.messages = data.messages;
            state.sessionId = session.id;
            renderMessages();
        }
    } catch (e) {
        if (token === state.chatRequest) notify(e.message);
    }
}
async function sendChat(e) {
    e.preventDefault();
    if (state.chatBusy) return;
    const input = e.target.elements.message,
        message = input.value.trim();
    if (!message) return;
    const token = ++state.chatRequest,
        id = state.client.id,
        scope = state.scope,
        scope_id = state.scopeId;
    state.chatBusy = true;
    renderMessages();
    e.target.querySelector('button[aria-label="Отправить"]').disabled = true;
    try {
        const r = await api.write(id, '/chat', {
            message,
            scope,
            scope_id,
            session_id: state.sessionId,
            version: state.version
        });
        if (token !== state.chatRequest) return;
        state.messages = r.messages;
        state.sessionId = r.session_id;
        input.value = '';
    } catch (err) {
        if (token === state.chatRequest) notify(err.message);
    } finally {
        if (token === state.chatRequest) {
            state.chatBusy = false;
            renderMessages();
            const b = document.querySelector('button[aria-label="Отправить"]');
            if (b) b.disabled = false;
        }
    }
}
async function chooseScope(scope) {
    if (state.chatBusy) return notify('Дождитесь ответа ассистента.');
    if (scope === 'client') {
        state.scope = scope;
        state.scopeId = null;
        state.version = null;
        await loadMap();
        await loadChat();
        return;
    }
    const items = scope === 'deal' ? state.deals : state.people;
    if (!items.length) return notify(scope === 'deal' ? 'У клиента пока нет сделок.' : 'У клиента пока нет контактов.');
    showDialog(scope === 'deal' ? 'Выберите сделку' : 'Выберите человека', `<div class="list">${items.map(x=>`<button type="button" data-choice="${esc(x.id)}">${esc(x.name)}<small>${esc(x.title||x.description||'')}</small></button>`).join('')}</div>`);
    dialog.querySelectorAll('[data-choice]').forEach(b => b.onclick = async () => {
        dialog.close();
        state.scope = scope;
        state.scopeId = b.dataset.choice;
        state.version = null;
        try {
            await loadMap();
            await loadChat();
        } catch (e) {
            notify(e.message);
        }
    });
}

function detail(html) {
    app.querySelector('.detail')?.remove();
    app.insertAdjacentHTML('beforeend', `<aside class="detail" aria-label="Карточка"><button class="close" data-action="close-detail" aria-label="Закрыть карточку">×</button>${html}</aside>`);
}
async function person(id) {
    const token = state.request,
        cid = state.client.id;
    try {
        const p = state.graph.nodes.find(n => n.id === id)?.data;
        if (!p) return;
        const current = state.version ? null : await api.get(cid, '/people/' + encodeURIComponent(id));
        if (token !== state.request) return;
        const relations = current?.relations || state.graph.edges.map(e => e.data).filter(r => r.from_person_id === id || r.to_person_id === id);
        detail(`<div class="eyebrow">Клиент</div><h2>${esc(p.title||p.department)}</h2><h3>${esc(p.name)}</h3><div class="label">Роль</div><p>${esc(p.communication_notes||'Не указана')}</p>${relations.map(r=>`<div class="label">Связь</div><p>${esc(r.description)}</p>${r.evidence[0]?`<blockquote>${esc(r.evidence[0].quote)}</blockquote>`:''}<button class="link" data-relation="${esc(r.id)}">См. больше</button>`).join('')}<button class="action primary" data-edit-person="${esc(id)}" ${state.version||state.user.role!=='editor'?'disabled':''}>Предложить правку</button>`);
    } catch (e) {
        notify(e.message);
    }
}
async function relation(id) {
    const r = state.graph.edges.find(e => e.id === id)?.data;
    if (!r) return;
    detail(`<div class="eyebrow">Связь</div><h2>${esc(r.description||'Связь контактов')}</h2><div class="label">Основание</div>${r.evidence.map(e=>`<blockquote>${esc(e.quote)}</blockquote><button class="link" data-source="${esc(e.source_id)}">См. больше</button>`).join('')||'<p>Источник не указан</p>'}<p>${{proposed:'Предположение',confirmed:'Подтверждено',rejected:'Отклонено'}[r.status]}</p><button class="action primary" data-review="${esc(id)}" data-status="confirmed" ${state.version||state.user.role!=='editor'?'disabled':''}>Проверить факт · подтвердить</button><button class="action" data-review="${esc(id)}" data-status="rejected" ${state.version||state.user.role!=='editor'?'disabled':''}>Отклонить</button>`);
}
async function refresh() {
    const id = state.client.id;
    const [c, p, d, h] = await Promise.all([api.get(id, ''), api.get(id, '/people'), api.get(id, '/deals'), api.get(id, '/history')]);
    if (state.client?.id !== id) return;
    Object.assign(state, {
        client: c,
        people: p.items,
        deals: d.items,
        history: h.items,
        version: null
    });
    await loadMap();
}
async function editPerson(id) {
    const current = await api.get(state.client.id, '/people/' + encodeURIComponent(id));
    const p = current.person;
    showDialog('Правка контакта', `<label>Имя<input name="name" value="${esc(p.name)}" required maxlength="500"></label><label>Должность<input name="title" value="${esc(p.title)}"></label><label>Подразделение<input name="department" value="${esc(p.department)}"></label><label>Предпочтения общения<textarea name="communication_notes">${esc(p.communication_notes)}</textarea></label><button class="primary">Сохранить</button>`, async data => {
        await api.write(state.client.id, '/people/' + encodeURIComponent(id), {
            expected_version: current.version,
            changes: Object.fromEntries(data)
        }, 'PATCH');
        dialog.close();
        await refresh();
        notify('Контакт обновлён.');
    });
}
async function source(id) {
    const s = await api.get(state.client.id, '/sources/' + encodeURIComponent(id));
    showDialog(s.title, `<pre>${esc(s.text)}</pre><p class="hint">${esc(new Date(s.source_date).toLocaleString('ru-RU'))}</p>`);
}
async function sources() {
    if (!state.client) return notify('Сначала откройте клиента.');
    const data = await api.get(state.client.id, '/sources');
    showDialog('Источники', `<div class="list">${data.items.map(s=>`<button type="button" data-open-source="${esc(s.id)}">${esc(s.title)}<small>${esc(s.kind)}</small></button>`).join('')||'<p>Источников пока нет</p>'}</div>${state.user.role==='editor'?'<button type="button" data-upload>Добавить источник</button>':''}`);
    dialog.querySelectorAll('[data-open-source]').forEach(b => b.onclick = () => source(b.dataset.openSource).catch(e => notify(e.message)));
    dialog.querySelector('[data-upload]')?.addEventListener('click', upload);
}

function upload() {
    if (!state.client || state.user.role !== 'editor') return;
    const clientId = state.client.id,
        version = state.client.version;
    showDialog('Добавить источник', `<label>Название<input name="title" required maxlength="500"></label><label>Дата<input name="date" type="datetime-local" required></label><label>Текст протокола<textarea name="text" required maxlength="100000"></textarea></label><label>Или текстовый файл<input id="text-file" type="file" accept=".txt,text/plain"></label><p class="hint">Текст будет сохранён и обработан. Найденные связи потребуют подтверждения.</p><button class="primary">Сохранить и обработать</button>`, async data => {
        const saved = await api.write(clientId, '/sources', {
            title: data.get('title'),
            text: data.get('text'),
            kind: 'protocol',
            source_date: new Date(data.get('date')).toISOString()
        }, 'POST', version);
        const job = await api.write(clientId, '/sources/' + encodeURIComponent(saved.item.id) + '/process');
        dialog.close();
        await refresh();
        notify('Источник сохранён. Обработка запущена.');
        pollJob(job.id, clientId);
    });
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    dialog.querySelector('[name=date]').value = d.toISOString().slice(0, 16);
    dialog.querySelector('#text-file').onchange = async e => {
        const f = e.target.files[0];
        if (!f) return;
        if (f.size > 400000) return notify('Файл слишком большой. Максимум 100 000 символов.');
        const text = await f.text();
        if (text.length > 100000) return notify('Максимум 100 000 символов.');
        dialog.querySelector('[name=text]').value = text;
        if (!dialog.querySelector('[name=title]').value) dialog.querySelector('[name=title]').value = f.name;
    };
}
async function pollJob(id, clientId) {
    for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 1500));
        try {
            const j = await api.request('/jobs/' + encodeURIComponent(id));
            if (j.status === 'completed') {
                if (state.client?.id === clientId) await refresh();
                return notify('Обработка завершена. Карта обновлена.');
            }
            if (j.status === 'failed') return notify('Не удалось обработать источник: ' + (j.error || 'ошибка сервера'));
        } catch (e) {
            return notify(e.message);
        }
    }
    notify('Обработка продолжается. Её состояние можно проверить в настройках.');
    sessionStorage.setItem('krok-job', id);
}

function settings() {
    showDialog('Настройки', `<p>${esc(state.user.user_id)} · ${state.user.role==='editor'?'Редактор':'Просмотр'}</p><p class="hint">${state.user.assistant_mode==='demo'?'Ассистент работает в деморежиме: возвращает обзор данных клиента.':'Модель: '+esc(state.user.assistant_model||'Llama')+' · локально на сервере'}</p><p class="hint">MCP: ${esc(location.origin+'/mcp/')} · авторизация Bearer</p><button type="button" data-refresh>Обновить данные</button><button type="button" data-logout>Выйти</button>${sessionStorage.getItem('krok-job')?'<button type="button" data-job>Проверить обработку</button>':''}`);
    dialog.querySelector('[data-refresh]').onclick = async () => {
        dialog.close();
        try {
            state.client ? await refresh() : await clients();
        } catch (e) {
            notify(e.message);
        }
    };
    dialog.querySelector('[data-logout]').onclick = () => {
        dialog.close();
        sessionStorage.removeItem('krok-key');
        api.key = '';
        state.user = null;
        state.client = null;
        ++state.request;
        ++state.chatRequest;
        login();
    };
    dialog.querySelector('[data-job]')?.addEventListener('click', async () => {
        try {
            const j = await api.request('/jobs/' + encodeURIComponent(sessionStorage.getItem('krok-job')));
            notify('Статус: ' + j.status);
        } catch (e) {
            notify(e.message);
        }
    });
}
app.addEventListener('click', async e => {
    const b = e.target.closest('button,[data-relation]');
    if (!b || b.disabled) return;
    try {
        if (b.dataset.client) {
            location.hash = '/clients/' + encodeURIComponent(b.dataset.client);
            return;
        }
        if (b.dataset.scope) return await chooseScope(b.dataset.scope);
        if (b.dataset.person) return await person(b.dataset.person);
        if (b.dataset.relation) return await relation(b.dataset.relation);
        if (b.dataset.source) return await source(b.dataset.source);
        if (b.dataset.editPerson) return await editPerson(b.dataset.editPerson);
        if (b.dataset.review) {
            b.disabled = true;
            await api.write(state.client.id, '/relations/' + encodeURIComponent(b.dataset.review) + '/review', {
                expected_version: state.graph.version,
                status: b.dataset.status
            }, 'PATCH');
            await refresh();
            return notify('Проверка связи сохранена.');
        }
        switch (b.dataset.action) {
            case 'scope-detail':
                if (state.scope === 'person') {
                    await person(state.scopeId);
                } else {
                    const d = await api.get(state.client.id, '/deals/' + encodeURIComponent(state.scopeId));
                    showDialog(d.item.name, `<p>${esc(d.item.description)}</p><p>${esc(d.item.stage)}</p><p>${d.item.amount===null?'':esc(new Intl.NumberFormat('ru-RU',{style:'currency',currency:d.item.currency}).format(d.item.amount))}</p>`);
                }
                break;
            case 'clients':
                goHome();
                break;
            case 'collapse':
                state.collapsed = !state.collapsed;
                renderMap();
                break;
            case 'close-detail':
                app.querySelector('.detail')?.remove();
                break;
            case 'sources':
                await sources();
                break;
            case 'upload':
                upload();
                break;
            case 'settings':
                settings();
                break;
            case 'next':
                state.page++;
                await clients();
                break;
            case 'prev':
                state.page--;
                await clients();
                break;
        }
    } catch (err) {
        b.disabled = false;
        notify(err.message);
    }
});
app.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-relation]')) {
        e.preventDefault();
        e.target.dispatchEvent(new MouseEvent('click', {
            bubbles: true
        }));
    }
});
window.addEventListener('hashchange', route);
if (api.key) {
    try {
        state.user = await api.request('/me');
        await route();
    } catch (e) {
        notify(e.message);
        login();
    }
} else login();


function historyCaption(version) {
    const entry = state.history.find(h => h.version === version);
    const date = entry?.created_at || entry?.at;
    const action = ({
        'person.updated': 'Правка контакта',
        'person.created': 'Добавлен контакт',
        'relation.reviewed': 'Проверка связи',
        'relation.created': 'Добавлена связь',
        'source.created': 'Добавлен источник',
        'source.processed': 'Обработка источника',
        'deal.created': 'Добавлена сделка',
        'deal.updated': 'Правка сделки',
        'interaction.created': 'Новое взаимодействие',
        'client.created': 'Создан клиент'
    })[entry?.action] || 'Снимок карты';
    return `Версия ${version} · ${action}` + (date ? ` · ${new Date(date).toLocaleString('ru-RU')}` : '') + (version === state.client?.version ? ' · сейчас' : '');
}
async function scrubHistory(version, token) {
    if (token !== state.request || !state.client) return;
    const clientId = state.client.id;
    const query = new URLSearchParams({
        scope: state.scope,
        version
    });
    if (state.scopeId) query.set('scope_id', state.scopeId);
    const url = api.client(clientId, '/map?' + query);
    const cacheKey = state.user.user_id + url;
    historyController = new AbortController();
    try {
        const graph = historyCache.get(cacheKey) || await api.request(url, {
            signal: historyController.signal
        });
        if (token !== state.request) return;
        historyCache.set(cacheKey, graph);
        if (historyCache.size > 80) historyCache.delete(historyCache.keys().next().value);
        state.version = version === state.client.version ? null : version;
        state.graph = graph;
        renderMap(true);
    } catch (e) {
        if (e.name === 'AbortError' || token !== state.request) return;
        app.querySelector('.history-caption').textContent = 'Не удалось загрузить версию';
        notify(e.message);
    }
}
