'use strict';
const $=s=>document.querySelector(s), app=$('#app'), dialog=$('#dialog'), dock=$('#dock');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const I=n=>window.ICONS[n]||'';
const brandUrl=id=>['vtb','mvideo','s7'].includes(id)?'/ui-assets/brands/'+id+'.svg':Object.prototype.hasOwnProperty.call(window.BRANDS,id)?'data:image/webp;base64,'+window.BRANDS[id]:'';
const R={strong:'Устойчивые',developing:'Развивающиеся',weak:'Слабые',unknown:'Неизвестно'};
const K={influences:'Влияет',reports_to:'Подчиняется',collaborates:'Сотрудничает',delegates:'Делегирует',approves:'Согласует'};
const S={proposed:'Предложено',confirmed:'Подтверждено',rejected:'Отклонено'};
const state={key:sessionStorage.getItem('krok_api_key')||'',me:null,clients:[],client:null,graph:null,fullPeople:[],deals:[],history:[],version:null,scope:'client',scopeId:null,selected:null,edge:null,detail:null,filter:{},collapsed:{assistant:false,contact:false},chats:new Map(),pending:false,epoch:0,graphEpoch:0};
const mobileQuery=matchMedia('(max-width: 700px)');
let mobilePanel='', mobileZoom=1.5, mobileCentered=false;
function mobileSheet(type){
 if(!mobileQuery.matches)return;
 mobilePanel=type===mobilePanel?'':type;
 if(mobilePanel&&state.collapsed[mobilePanel]){
  state.collapsed[mobilePanel]=false;
  if(mobilePanel==='assistant')renderAssistant();else renderContact();
 }
 applyMobile();
 if(mobilePanel==='assistant'){const log=$('#assistant-panel .chat-log');if(log)log.scrollTop=log.scrollHeight}
}
function applyMobile(){
 const screen=$('.map-screen');if(!screen)return;
 screen.dataset.mobilePanel=mobilePanel;
 for(const type of ['assistant','contact']){
  const toggle=screen.querySelector('[data-action="mobile-'+type+'"]');
  if(toggle)toggle.setAttribute('aria-expanded',String(mobilePanel===type));
 }
 const stage=$('#graph-content');
 if(stage){stage.style.setProperty('--mobile-zoom',mobileZoom);if(mobileQuery.matches&&!mobileCentered){mobileCentered=true;stage.scrollLeft=(stage.scrollWidth-stage.clientWidth)/2;stage.scrollTop=(stage.scrollHeight-stage.clientHeight)/2}}
}
function mobileScale(delta){
 const stage=$('#graph-content');if(!stage)return;
 const x=(stage.scrollLeft+stage.clientWidth/2)/Math.max(1,stage.scrollWidth),y=(stage.scrollTop+stage.clientHeight/2)/Math.max(1,stage.scrollHeight);
 mobileZoom=delta===0?1:Math.max(1,Math.min(2.5,mobileZoom+delta));applyMobile();
 stage.scrollLeft=x*stage.scrollWidth-stage.clientWidth/2;stage.scrollTop=y*stage.scrollHeight-stage.clientHeight/2;
}
function mobileContacts(){
 modal('Контакты · '+state.client.name,'<div class="detail-list">'+(state.graph.nodes.length?state.graph.nodes.map(n=>'<button class="detail-item mobile-person-choice '+(n.id===state.selected&&!state.edge?'selected':'')+'" aria-pressed="'+(n.id===state.selected&&!state.edge)+'" data-mobile-person="'+esc(n.id)+'"><b>'+esc(n.data.name)+'</b><span class="muted small">'+esc(n.data.title||n.data.department||'Контакт')+'</span></button>').join(''):'<p class="muted">Нет контактов</p>')+'</div>');
}
mobileQuery.addEventListener('change',()=>{mobilePanel='';mobileCentered=false;applyMobile()});
const editor=()=>state.me?.role==='editor';
const path=(suffix='')=>'/clients/'+encodeURIComponent(state.client.id)+suffix;
let historyTimer, historyPending=false;
const current=()=>state.version===null&&!historyPending;
const person=()=>state.graph?.nodes.find(n=>n.id===state.selected)?.data;
const edge=()=>state.graph?.edges.find(e=>e.id===state.edge)?.data;
const date=v=>{const d=new Date(v);return Number.isNaN(+d)?'':d.toLocaleString('ru-RU',{dateStyle:'medium',timeStyle:'short'})};
function noun(n,forms){const a=n%100,b=n%10;return a>=11&&a<=14?forms[2]:b===1?forms[0]:b>=2&&b<=4?forms[1]:forms[2]}
async function api(url,opts={}){
 const response=await fetch('/api/v1'+url,{...opts,headers:{'X-API-Key':state.key,...(opts.body?{'Content-Type':'application/json'}:{}),...opts.headers}});
 let data;try{data=await response.json()}catch{data=null}
 if(!response.ok){const msg=typeof data?.detail==='string'?data.detail:JSON.stringify(data?.detail||'Ошибка '+response.status);const error=new Error(msg);error.status=response.status;throw error}
 return data;
}
let toastTimer;
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),3500)}
function fail(e){if(e.status===401){settings(true);return}toast(e.status===409?'Данные изменились. Обновите карту и повторите действие.':e.message||'Ошибка запроса')}
function button(action,icon,label,cls='icon-button',disabled=false){return '<button type="button" class="'+cls+'" data-action="'+action+'" title="'+esc(label)+'" aria-label="'+esc(label)+'" '+(disabled?'disabled':'')+'>'+I(icon)+'</button>'}
// Reconcile live UI instead of remounting the map on every update.
function nodeKey(n){
 if(n.nodeType!==1)return null;
 if(n.id)return '#'+n.id;
 for(const k of ['data-person','data-edge','data-scope','data-action','data-source','data-process'])if(n.hasAttribute(k))return k+':'+n.getAttribute(k);
 if(n.localName==='circle'&&n.classList.contains('ring'))return 'ring:'+n.getAttribute('r');
 if(n.localName==='option')return 'option:'+n.value;
 return null;
}
function sameNode(a,b){return a.nodeType===b.nodeType&&(a.nodeType!==1||(a.localName===b.localName&&a.namespaceURI===b.namespaceURI&&nodeKey(a)===nodeKey(b)))}
function syncNode(old,fresh,keepPanels=false){
 if(old.nodeType!==1){if(old.nodeValue!==fresh.nodeValue)old.nodeValue=fresh.nodeValue;return}
 if(keepPanels&&(old.id==='assistant-panel'||old.id==='contact-panel'))return;
 for(const a of [...old.attributes])if(!fresh.hasAttributeNS(a.namespaceURI,a.localName))old.removeAttributeNS(a.namespaceURI,a.localName);
 for(const a of [...fresh.attributes])if(old.getAttributeNS(a.namespaceURI,a.localName)!==a.value)old.setAttributeNS(a.namespaceURI,a.name,a.value);
 syncChildren(old,fresh,keepPanels);
 if(['input','select','textarea'].includes(old.localName)&&old.value!==fresh.value)old.value=fresh.value;
}
function syncChildren(root,fresh,keepPanels=false){
 const old=[...root.childNodes],used=new Set();let cursor=root.firstChild;
 for(const n of [...fresh.childNodes]){
  const key=nodeKey(n);
  let match=key?old.find(o=>!used.has(o)&&sameNode(o,n)):((cursor&&old.includes(cursor)&&!used.has(cursor)&&sameNode(cursor,n))?cursor:old.find(o=>!used.has(o)&&!nodeKey(o)&&sameNode(o,n)));
  if(match){used.add(match);if(match!==cursor)root.insertBefore(match,cursor);syncNode(match,n,keepPanels)}
  else {match=n.cloneNode(true);root.insertBefore(match,cursor)}
  cursor=match.nextSibling;
 }
 for(const o of old)if(!used.has(o))o.remove();
}
function updateMapShell(html){
 const live=app.querySelector('.map-screen');
 if(!live){app.innerHTML=html;return}
 const oldEdges=new Map([...live.querySelectorAll('[data-edge]')].map(el=>[el.dataset.edge,['x1','y1','x2','y2'].map(k=>Number(el.getAttribute(k)))]));
 const oldPeople=new Set([...live.querySelectorAll('.graph [data-person]')].map(el=>el.dataset.person));
 const t=document.createElement('template');t.innerHTML=html;
 syncNode(live,t.content.firstElementChild,true);
 animateEdges(live,oldEdges);
 if(!reducedMotion.matches){
  for(const node of live.querySelectorAll('.graph [data-person]')){
   if(!oldPeople.has(node.dataset.person))node.animate([{opacity:.55},{opacity:1}],{duration:180,easing:motionEase});
  }
 }
}
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
const motionEase='cubic-bezier(.333,1,.667,1)';
const graphMotionMs=300;
let edgeFrame;
function animateEdges(root,previous){
 cancelAnimationFrame(edgeFrame);
 if(reducedMotion.matches)return;
 const attrs=['x1','y1','x2','y2'];
 const moves=[...root.querySelectorAll('[data-edge]')].filter(el=>previous.has(el.dataset.edge)).map(el=>({el,from:previous.get(el.dataset.edge),to:attrs.map(k=>Number(el.getAttribute(k)))})).filter(m=>m.from.some((v,i)=>v!==m.to[i]));
 if(!moves.length)return;
 const start=performance.now();
 function frame(now){
  if(!root.isConnected)return;
  const t=reducedMotion.matches?1:Math.min(1,(now-start)/graphMotionMs),ease=1-Math.pow(1-t,3);
  for(const m of moves)attrs.forEach((k,i)=>m.el.setAttribute(k,m.from[i]+(m.to[i]-m.from[i])*ease));
  if(t<1)edgeFrame=requestAnimationFrame(frame);
 }
 frame(start);
}
function updatePanel(id,render){
 const live=document.getElementById(id);if(!live)return;
 const fresh=live.cloneNode(false);
 render(fresh);
 syncNode(live,fresh);
}
function renderDock(active='map'){const html=[['map','Клиенты'],['sources','Источники'],['settings','Настройки']].map(([n,l])=>button(n,n,l,n===active?'active':'')).join('');if(dock.innerHTML!==html){const t=document.createElement('template');t.innerHTML=html;syncChildren(dock,t.content)}}
function modal(title,body){$('#dialog-title').textContent=title;$('#dialog-content').innerHTML=body;if(!dialog.open)dialog.showModal()}
function formModal(title,body,submit,label='Сохранить'){
 modal(title,'<form class="dialog-form">'+body+'<div class="error" role="alert"></div><div class="dialog-actions"><button type="button" class="pill secondary" data-close>Отмена</button><button class="pill primary" type="submit">'+esc(label)+'</button></div></form>');
 const form=dialog.querySelector('form');form.addEventListener('submit',async ev=>{ev.preventDefault();const b=form.querySelector('[type=submit]');b.disabled=true;form.querySelector('.error').textContent='';try{await submit(new FormData(form));if(dialog.open&&dialog.contains(form))dialog.close()}catch(e){form.querySelector('.error').textContent=e.status===409?'Версия устарела. Закройте окно и обновите карту.':e.message}finally{b.disabled=false}})
}
function settings(required=false){renderDock('settings');formModal('Подключение к CRM','<p>Введите ключ доступа, настроенный на сервере. Он хранится только в текущей вкладке браузера.</p><label>API-ключ<input name="key" type="password" required autocomplete="off" value="'+esc(state.key)+'"></label>'+(state.me?'<p class="muted">Роль: '+esc(editor()?'Редактор':'Просмотр')+' · Ассистент: '+esc(state.me.assistant_mode)+'</p>':''),async f=>{const old=state.key;state.key=String(f.get('key')).trim();try{const me=await api('/me');state.me=me;sessionStorage.setItem('krok_api_key',state.key);state.chats.clear();await showClients()}catch(e){state.key=old;throw e}},'Подключиться');if(required)app.innerHTML='<div class="error-screen">Для работы с картой необходимо подключение к CRM.<p><button class="pill" data-action="settings">Ввести API-ключ</button></p></div>'}
function renderClients(){renderDock();app.innerHTML='<section class="screen clients" aria-label="Клиенты">'+(state.clients.length?state.clients.map(c=>{const n=c.contacts_count||0,u=c.updates_count||0,v=c.coverage||{},logo=brandUrl(c.id),ratio=v.ratio==null?0:Math.max(0,Math.min(1,v.ratio));return '<button class="client-card" data-client="'+esc(c.id)+'"><div class="client-head"><span class="client-name">'+esc(c.name)+'</span><span class="count">'+(n?n+' '+noun(n,['контакт','контакта','контактов']):'нет контактов')+'</span></div><div class="updates '+(u?'active':'')+'">'+I('mail')+'<span>'+(u?u+' '+noun(u,['обновление','обновления','обновлений']):n?'Нет обновлений':'Пусто')+'</span></div>'+(logo?'<img class="brand" src="'+logo+'" alt="">':'<span class="brand brand-fallback">'+esc(c.name.slice(0,2))+'</span>')+'<div class="coverage"><div class="coverage-label">Охват ЛПР <strong>'+(v.total?v.covered+' из '+v.total:'Нет данных')+'</strong></div><div class="progress"><span style="width:'+ratio*100+'%"></span></div></div><div class="card-arrow">'+I('cardright')+'</div></button>'}).join(''):'<div class="empty-list">Нет доступных клиентов</div>')+'</section>'}
async function showClients(){mobilePanel='';mobileCentered=false;stopHistory();const token=++state.epoch;state.graphEpoch++;state.client=null;state.graph=null;state.detail=null;renderDock();app.innerHTML='<div class="startup">Загрузка клиентов…</div>';try{const r=await api('/clients');if(token!==state.epoch)return;const order=['krasnodar','vtb','mvideo','s7'];const rank=id=>{const i=order.indexOf(id);return i<0?order.length:i};state.clients=r.items.slice().sort((a,b)=>rank(a.id)-rank(b.id)||a.name.localeCompare(b.name,'ru'));renderClients()}catch(e){if(token!==state.epoch)return;if(e.status===401)settings(true);else{app.innerHTML='<div class="error-screen">'+esc(e.message)+'<p><button class="pill" data-action="map">Повторить</button></p></div>'}}}
async function openClient(id){mobilePanel='';mobileZoom=1.5;mobileCentered=false;stopHistory();const token=++state.epoch;state.graphEpoch++;state.client=state.clients.find(c=>c.id===id)||{id,name:id};Object.assign(state,{graph:null,fullPeople:[],deals:[],history:[],version:null,scope:'client',scopeId:null,selected:null,edge:null,detail:null,filter:{},collapsed:{assistant:false,contact:false}});if(!app.querySelector('.map-screen'))app.innerHTML='<div class="startup">Загрузка карты…</div>';try{const [c,p,d,h]=await Promise.all([api(path()),api(path('/people')),api(path('/deals')),api(path('/history'))]);if(token!==state.epoch)return;state.client=c;state.fullPeople=p.items;state.deals=d.items;state.history=h.items;await loadMap();if(token!==state.epoch)return;await api(path('/read?version='+c.version),{method:'POST'}).catch(()=>{});loadChat()}catch(e){if(token!==state.epoch)return;fail(e);app.innerHTML='<div class="error-screen">'+esc(e.message)+'<p><button class="pill" data-action="map">К клиентам</button></p></div>'}}
function params(){const q=new URLSearchParams({scope:state.scope});if(state.scopeId)q.set('scope_id',state.scopeId);if(state.version!==null)q.set('version',state.version);for(const [k,v] of Object.entries(state.filter))if(v)q.set(k,v);if(mgPrefs.verified)q.set('status','confirmed');return q}
async function loadMap(){stopHistory();const t=++state.graphEpoch,epoch=state.epoch;try{const g=await api(path('/map?')+params());if(t!==state.graphEpoch||epoch!==state.epoch)return;state.graph=g;if(current())state.client.version=g.version;if(!g.nodes.some(n=>n.id===state.selected))state.selected=g.nodes[0]?.id||null;if(!g.edges.some(e=>e.id===state.edge))state.edge=null;state.detail=null;renderMap();if(state.selected&&!state.edge)loadDetail()}catch(e){if(t!==state.graphEpoch||epoch!==state.epoch)return;if(e.status===404&&state.scope!=='client'){state.scope='client';state.scopeId=null;return loadMap()}throw e}}
async function loadDetail(){const id=state.selected,epoch=state.epoch,t=state.graphEpoch,version=state.graph?.version;if(!id||!version||historyPending)return;try{const d=await api(path('/people/'+encodeURIComponent(id)+'?version='+version));if(epoch===state.epoch&&t===state.graphEpoch&&id===state.selected&&!state.edge&&d.version===state.graph.version){state.detail=d;renderContact()}}catch(e){if(epoch===state.epoch&&t===state.graphEpoch&&id===state.selected)fail(e)}}
function short(s,n=20){return s.length>n?s.slice(0,n-1)+'…':s}
function displayName(n){const a=n.trim().split(/\s+/);return short(a.length===2?a[0][0]+'. '+a[1]:n,20)}
function positions(nodes){
 const p=Object.create(null), center={x:350,y:280}, radii=[0,112,145,185,242];
 const all=[...nodes].sort((a,b)=>a.id.localeCompare(b.id));
 const reference=[194,55,210,300,355,130],placed=[];
 for(let i=0;i<all.length;i++){
  const n=all[i],ring=Math.min(4,Math.max(1,n.ring||4)),radius=radii[ring];
  const match=n.id.match(/-p([1-6])$/),preferred=match?reference[Number(match[1])-1]:-90+i*137.507764;
  let best=null;
  for(let j=0;j<72;j++){
   const offset=j===0?0:(j%2?1:-1)*Math.ceil(j/2)*5,angle=(preferred+offset)*Math.PI/180;
   const a={x:center.x+Math.cos(angle)*radius,y:center.y+Math.sin(angle)*radius};
   const overlap=placed.reduce((s,b)=>s+Math.max(0,118-Math.abs(a.x-b.x))*Math.max(0,42-Math.abs(a.y-b.y)),0);
   const centerOverlap=Math.max(0,91-Math.abs(a.x-center.x))*Math.max(0,53-Math.abs(a.y-center.y));
   const cost=overlap*10+centerOverlap*20+Math.abs(offset);
   if(!best||cost<best.cost)best={...a,cost};
  }
  p[n.id]={x:best.x,y:best.y};placed.push(best);
 }
 return p;
}
function graphHTML(){const g=state.graph;if(!g)return '';const ps=positions(g.nodes),logo=brandUrl(state.client.id),center=state.scope==='client'?state.client.name:state.scope==='deal'?(state.deals.find(d=>d.id===state.scopeId)?.name||'Сделка'):(state.fullPeople.find(p=>p.id===state.scopeId)?.name||'Контакт');return '<svg class="graph" viewBox="0 0 720 540" role="group" aria-label="Интерактивная карта контактов">'+[[242,8,.10],[180,10,.20],[117,12,.40],[55,14,.60]].map(([r,w,o])=>'<circle class="ring" cx="350" cy="280" r="'+r+'" stroke-width="'+w+'" opacity="'+o+'"/>').join('')+g.edges.filter(e=>ps[e.source]&&ps[e.target]).map(e=>{const a=ps[e.source],b=ps[e.target];return '<line class="edge '+(e.data.status==='proposed'?'proposed ':'')+(e.id===state.edge?'selected':'')+'" x1="'+a.x+'" y1="'+a.y+'" x2="'+b.x+'" y2="'+b.y+'" stroke-width="'+(1.5+e.data.strength*.62)+'" tabindex="0" role="button" aria-label="'+esc(e.data.description||K[e.data.kind]||'Связь')+'" data-edge="'+esc(e.id)+'"><title>'+esc(e.data.description||K[e.data.kind])+'</title></line>'}).join('')+(logo&&state.scope==='client'?'<image href="'+logo+'" x="321" y="251" width="58" height="58" preserveAspectRatio="xMidYMid meet"/>':'<text class="center-label" x="350" y="284" text-anchor="middle">'+esc(short(center,15))+'</text>')+g.nodes.map(n=>{const a=ps[n.id],p=n.data;return '<g class="person '+(n.id===state.selected&&!state.edge?'selected':'')+'" transform="translate('+(a.x-57)+' '+(a.y-18)+')" data-person="'+esc(n.id)+'" role="button" tabindex="0" aria-pressed="'+(n.id===state.selected&&!state.edge)+'" aria-label="'+esc(p.name+', '+p.title)+'"><title>'+esc(p.name+' · '+p.title+' · '+R[p.relationship])+'</title><rect class="person-card" width="114" height="36" rx="18"/><svg class="person-avatar" x="6" y="6" width="24" height="24" viewBox="1540.79 772.98 59.4 59.4"><rect width="59.4" height="59.4" x="1540.79" y="772.98" rx="29.7" class="avatar-bg"/><path fill="white" d="M1593.3 831.605C1594.94 831.263 1595.92 829.545 1595.1 828.079C1593.31 824.849 1590.47 822.01 1586.85 819.847C1582.18 817.061 1576.46 815.551 1570.58 815.551C1564.69 815.551 1558.97 817.061 1554.3 819.847C1550.68 822.01 1547.84 824.849 1546.05 828.079C1545.23 829.545 1546.21 831.263 1547.85 831.605C1562.84 834.729 1578.31 834.729 1593.3 831.605Z"/><circle cx="1570.58" cy="797.731" r="14.85" fill="white"/></svg><text x="35" y="15" class="node-name">'+esc(displayName(p.name))+'</text><text x="35" y="27" class="node-dept">'+esc(short(p.department||p.title||'Контакт',16))+'</text></g>'}).join('')+'</svg>'}
function versions(){const latest=state.client?.version||1;return [...new Set([1,...state.history.map(h=>Number(h.version)).filter(Number.isFinite),latest])].filter(v=>v<=latest).sort((a,b)=>a-b)}
function scopePicker(){if(state.scope==='client')return '';const items=state.scope==='deal'?state.deals:state.fullPeople;return '<div class="scope-picker"><select id="scope-select" aria-label="Выбор '+(state.scope==='deal'?'сделки':'контакта')+'">'+items.map(x=>'<option value="'+esc(x.id)+'" '+(x.id===state.scopeId?'selected':'')+'>'+esc(x.name)+'</option>').join('')+'</select></div>'}
function panelHead(type,title){return '<div class="panel-heading"><span>'+title+'</span><button data-action="toggle-'+type+'" aria-label="Свернуть или развернуть '+title+'" aria-expanded="'+!state.collapsed[type]+'">'+I(state.collapsed[type]?'down':'up')+'</button></div>'}
function renderMap(){if(!state.graph)return;renderDock();const vs=versions(),index=state.version===null?vs.length-1:Math.max(0,vs.indexOf(state.version)),progress=vs.length>1?index/(vs.length-1)*100:50;updateMapShell('<section class="screen map-screen" data-mobile-panel="'+mobilePanel+'"><div class="mobile-map-heading"><h1>'+esc(state.client.name)+'</h1><div class="mobile-map-meta"><button type="button" class="mobile-back-link" data-action="map">Все клиенты</button><button type="button" class="mobile-back-link" data-action="proposals">Предложения CRM</button><span>'+state.graph.nodes.length+' '+noun(state.graph.nodes.length,['контакт','контакта','контактов'])+'</span></div></div><aside id="assistant-panel" class="panel assistant-panel"></aside><div class="graph-area">'+scopePicker()+'<div id="graph-content" style="width:100%;height:100%;--mobile-zoom:'+mobileZoom+'">'+graphHTML()+'</div>'+(state.graph.empty?'<div class="empty-map" role="status">Нет контактов для выбранного представления</div>':'')+'<div class="mobile-graph-controls"><button data-action="mobile-list">Список контактов</button><div class="mobile-zoom"><button data-action="zoom-out" aria-label="Уменьшить">−</button><button data-action="zoom-fit" aria-label="Показать всю карту">1:1</button><button data-action="zoom-in" aria-label="Увеличить">+</button></div></div></div><aside id="contact-panel" class="panel contact-panel"></aside><div class="timeline">'+button('prev-version','left','Предыдущая версия','',index===0)+'<input id="timeline" type="range" aria-label="Версия карты" aria-valuetext="'+esc(historyCaption())+'" min="0" max="'+(vs.length===1?2:vs.length-1)+'" value="'+(vs.length===1?1:index)+'" style="--progress:'+progress+'%" '+(vs.length===1?'disabled':'')+'>'+button('next-version','right','Следующая версия','',index===vs.length-1)+'<span class="timeline-label '+(current()?'':'historical')+'">'+esc(historyCaption())+'</span></div><div class="mobile-panel-tabs"><button data-action="mobile-assistant" aria-controls="assistant-panel" aria-expanded="false">Ассистент</button></div><header class="topbar">'+button('map','left','К списку клиентов')+'<div class="segmented" aria-label="Область карты">'+[['client','Клиент'],['deal','Сделка'],['person','Человек']].map(([s,l])=>'<button data-scope="'+s+'" class="'+(state.scope===s?'active':'')+'" aria-pressed="'+(state.scope===s)+'" '+((s==='deal'&&!state.deals.length||s==='person'&&!state.fullPeople.length)?'disabled':'')+'>'+l+'</button>').join('')+'</div>'+button('next-client','right','Следующий клиент','icon-button',state.clients.length<2)+'</header><button class="mobile-shade" data-action="mobile-close" aria-label="Закрыть панель"></button></section>');renderContact();renderAssistant();applyMobile()}
function renderContact(){updatePanel('contact-panel',renderContactContent)}
function factRefs(){return {...(state.graph?.source_refs||{}),...(state.detail?.source_refs||{})}}
function factStatus(kind,label){return '<span class="fact-status '+kind+'"><span aria-hidden="true"></span>'+esc(label)+'</span>'}
function sourceLink(id,refs=factRefs()){
 const src=refs[id];if(!src)return '<span class="fact-source missing">Источник недоступен в этой версии</span>';
 return '<button type="button" class="fact-source" data-action="fact-source:'+esc(encodeURIComponent(id))+'">'+esc(src.title)+' · '+esc(date(src.source_date))+'</button>';
}
function factEvidence(ev,refs){
 const evidence=ev||[];
 return evidence.length?'<div class="fact-evidence">'+[...new Set(evidence.map(x=>x.source_id))].map(id=>sourceLink(id,refs)).join('')+(mgPrefs.evidence?'<blockquote>«'+esc(evidence[0].quote)+'»</blockquote>':'')+'</div>':'<p class="fact-note">Подтверждающий источник не указан</p>';
}
function factRelation(r,refs){
 const hasProof=(r.evidence||[]).some(ev=>refs[ev.source_id]&&ev.quote);
 const status=r.status==='rejected'?['rejected','Отклонено']:r.status==='confirmed'&&hasProof?['confirmed','Подтверждено']:['proposed',r.status==='confirmed'?'Подтверждено в CRM · источник не указан':'Требует подтверждения'];
 return '<article class="fact-item" data-fact-id="'+esc(r.id)+'"><span class="fact-label">Связь · '+esc(K[r.kind]||r.kind)+'</span><p>'+esc(r.description||'Описание не указано')+'</p>'+factStatus(...status)+factEvidence(r.evidence,refs)+'</article>';
}
function factInteraction(i,refs){
 const labels={meeting:'Встреча',email:'Переписка',call:'Звонок',event:'Событие',note:'Заметка'};
 return '<article class="fact-item"><span class="fact-label">'+esc(labels[i.kind]||'Взаимодействие')+' · '+esc(date(i.occurred_at))+'</span><p>'+esc(i.summary)+'</p>'+factStatus('recorded','Запись взаимодействия · не проверена')+(i.source_id?sourceLink(i.source_id,refs):'<p class="fact-note">Источник не указан</p>')+'</article>';
}
function renderContactContent(root){
 root.classList.toggle('collapsed',state.collapsed.contact);
 root.innerHTML=panelHead('contact',state.edge?'Связь':'Контакт');
 if(state.collapsed.contact)return;
 const e=edge(),p=person(),refs=factRefs();
 if(e){
  const a=state.graph.nodes.find(n=>n.id===e.from_person_id)?.data,b=state.graph.nodes.find(n=>n.id===e.to_person_id)?.data;
  root.innerHTML+='<div class="contact-body"><h2>'+esc(K[e.kind]||e.kind)+'</h2><p>'+esc(a?.name)+' → '+esc(b?.name)+'</p><p class="fact-note">Сила связи: '+e.strength+'/5</p>'+factRelation(e,refs)+'</div><div class="contact-actions"><button class="pill" data-action="verify">Проверить факт</button>'+(editor()&&current()?'<button class="pill secondary" data-action="review">Рассмотреть связь</button>':'')+'</div>';return;
 }
 if(!p){root.innerHTML+='<div class="contact-body muted">Выберите контакт на карте.</div>';return}
 const d=state.detail?.person?.id===p.id&&state.detail.version===state.graph.version?state.detail:null;
 const relations=d?.relations||state.graph.edges.filter(x=>x.source===p.id||x.target===p.id).map(x=>x.data);
 const deals=(d?.deals||state.graph.deals||[]).filter(x=>Object.hasOwn(x.participants||{},p.id));
 const isDemo=state.graph.client?.crm_id==='demo-'+state.client.id;
 let body='<div class="contact-body fact-card"><h2>'+esc(p.title||'Контакт')+'</h2><p>'+esc(p.name)+'</p><button class="fact-crm" data-action="crm-record">Карточка CRM'+(isDemo?' · демо':' · локальная запись')+' '+I('right')+'</button>'+factStatus('recorded','Базовые сведения из сохранённой карточки');
 if(p.department)body+='<article class="fact-item"><span class="fact-label">Подразделение</span><p>'+esc(p.department)+'</p>'+factStatus('recorded','Запись CRM · не проверена отдельно')+'</article>';
 if(p.evidence?.length)body+='<article class="fact-item"><span class="fact-label">Сведения о контакте</span>'+factStatus('proposed','Источник указан · требует проверки')+factEvidence(p.evidence,refs)+'</article>';
 for(const deal of deals)body+='<article class="fact-item"><span class="fact-label">Участие в проектах · '+esc(deal.name)+'</span><p>'+esc(deal.participants[p.id]||'Роль не указана')+'</p>'+factStatus('proposed','Требует подтверждения')+'<p class="fact-note">Роль записана в сделке CRM; отдельный источник не указан.</p></article>';
 body+=relations.map(r=>factRelation(r,refs)).join('');
 if(d?.interactions?.length)body+=factInteraction(d.interactions[0],refs)+'<button class="more" data-action="interactions">История взаимодействий</button>';
 if(!d&&!historyPending)body+='<p class="fact-note">Загружаем источники и взаимодействия…</p>';
 if(d&&!relations.length&&!deals.length&&!p.evidence?.length&&!d.interactions.length)body+='<p class="fact-note">Нет сведений с привязанными источниками.</p>';
 body+='</div><div class="contact-actions"><button class="pill" data-action="verify">Проверить факт</button><button class="pill secondary" data-action="edit-person" '+(!editor()||!current()?'disabled':'')+'>Предложить правку</button>'+(!editor()?'<span class="fact-note">Правки доступны редактору CRM.</span>':!current()?'<span class="fact-note">Правки доступны в текущей версии.</span>':'')+'</div>';
 root.innerHTML+=body;
}
function crmRecord(){
 const p=person();if(!p)return;
 modal('Карточка CRM','<div class="detail-list"><div class="detail-item"><b>'+esc(p.name)+'</b><p>'+esc(p.title||'Должность не указана')+'</p><p>'+esc(p.department||'')+'</p><p class="small muted">ID контакта: '+esc(p.id)+' · версия '+state.graph.version+'</p></div><p class="muted small">Сохранённая запись прототипа. Синхронизация и внешняя ссылка на промышленную CRM не настроены.</p></div>');
}

function chatKey(){return [state.client?.id,state.scope,state.scopeId||'',state.graph?.version||''].join('|')}
function chatState(){const k=chatKey();if(!state.chats.has(k))state.chats.set(k,{messages:[],session:null,loading:false,loaded:false});return state.chats.get(k)}
function renderAssistant(){const live=$('#assistant-panel');if(!live)return;const oldLog=live.querySelector('.chat-log'),atBottom=!oldLog||oldLog.scrollHeight-oldLog.scrollTop-oldLog.clientHeight<24;updatePanel('assistant-panel',renderAssistantContent);const log=live.querySelector('.chat-log');if(log&&atBottom)log.scrollTop=log.scrollHeight}
function renderAssistantContent(r){const c=chatState();r.classList.toggle('collapsed',state.collapsed.assistant);r.innerHTML=panelHead('assistant','Ассистент');if(state.collapsed.assistant)return;const draft=c.draft||'';r.innerHTML+='<div class="assistant-tools" aria-label="Аналитика карты">'+[['copilot-summary','Сводка'],['copilot-compare','Сравнить версии'],['copilot-recommendations','Рекомендации'],['copilot-help','Помощь']].map(([action,label])=>'<button type="button" class="pill" data-action="'+action+'" '+(c.loading||historyPending?'disabled':'')+'>'+label+'</button>').join('')+'</div><button type="button" class="pill agent-connect" data-action="connect-agent">Подключить своего агента</button><button type="button" class="pill proposal-entry" data-action="proposals">Предложения CRM</button><div class="chat-log" role="log">'+c.messages.map(m=>'<div class="bubble '+(m.role==='user'?'user':'assistant')+'">'+esc(m.content)+'</div>').join('')+(c.loading?'<div class="bubble assistant muted">Думаю…</div>':'')+'<div class="small muted">Контекст: версия '+state.graph.version+'. Сводка и рекомендации — автоматическая аналитика.</div>'+'</div><form class="chat-form" id="chat-form">'+button('add-source','plus','Добавить источник','',!editor()||!current())+'<input id="chat-input" aria-label="Сообщение ассистенту" placeholder="Есть мысли?" maxlength="4000" value="'+esc(draft)+'" '+(historyPending?'disabled':'')+'><button type="submit" aria-label="Отправить" '+(c.loading||historyPending?'disabled':'')+'>'+I('send')+'</button></form>'}
async function loadChat(){const c=chatState(),k=chatKey(),epoch=state.epoch;if(c.loaded||c.loading)return;c.loaded=true;if(!current())return;try{const r=await api(path('/chat/sessions'));const s=r.items.find(s=>s.scope===state.scope&&(s.scope_id||null)===(state.scopeId||null));if(epoch!==state.epoch||k!==chatKey())return;if(s){const d=await api(path('/chat/sessions/'+encodeURIComponent(s.id)));if(epoch===state.epoch&&k===chatKey()&&!c.loading){c.session=d.id;c.messages=d.messages;renderAssistant()}}}catch(e){c.loaded=false;if(epoch===state.epoch)fail(e)}}
async function sendChat(message,options={}){if(!message.trim()||historyPending)return;const c=chatState(),k=chatKey(),epoch=state.epoch;if(c.loading)return;const previous=c.messages.slice();c.messages.push({role:'user',content:message});c.loading=true;c.draft='';renderAssistant();try{const body={message,scope:state.scope,scope_id:state.scopeId,session_id:c.session,version:state.graph.version,...options};const r=await api(path('/chat'),{method:'POST',body:JSON.stringify(body)});c.messages=state.me?.public_demo?[...previous,...r.messages]:r.messages;c.session=state.me?.public_demo?null:r.session_id;c.loaded=true}catch(e){c.messages=previous;c.draft=message;fail(e)}finally{c.loading=false;if(epoch===state.epoch&&k===chatKey())renderAssistant()}}
function compareVersions(){
 const vs=versions(),selected=state.graph.version,index=vs.indexOf(selected),previous=vs[Math.max(0,index-1)];
 formModal('Сравнение версий','<p>Сравнить сохранённый снимок с версией '+selected+' в выбранном контексте.</p><label>Исходная версия<select name="compare_version">'+vs.map(v=>'<option value="'+v+'" '+(v===previous?'selected':'')+'>Версия '+v+'</option>').join('')+'</select></label>',async f=>{await sendChat('Сравнить версии '+f.get('compare_version')+' → '+selected,{intent:'compare',compare_version:Number(f.get('compare_version'))})},'Сравнить');
}
let agentController;
function agentMcpPath(){return state.me?.public_demo?'/mcp-demo/':'/mcp/'}
function connectAgent(){
 modal('Подключить своего агента','<div class="dialog-form"><label>Клиент<select id="agent-client"><option value="codex">GPT через Codex MCP</option><option value="claude">Claude Desktop</option><option value="custom">Custom MCP</option></select></label><label>Адрес MCP<input readonly value="'+esc(location.origin+agentMcpPath())+'"></label><p id="agent-status" role="status">Доступность ещё не проверена.</p><button type="button" class="pill" data-action="check-agent">Проверить сервер</button><div id="agent-instructions"></div><p class="small muted">Проверка выполняется из этого браузера. Она не подтверждает подключение внешнего агента. Его ответы остаются в Codex, Claude или другом MCP-клиенте.</p></div>');
 agentInstructions();checkAgent();
}
function agentInstructions(){
 const target=$('#agent-instructions');if(!target)return;
 const kind=$('#agent-client').value,url=location.origin+agentMcpPath();
 const code=text=>'<pre class="agent-config"><code>'+esc(text)+'</code></pre>';
 const local=location.hostname==='localhost'||location.hostname==='127.0.0.1';
 let html='';
 if(state.me?.public_demo){
  if(kind==='codex')html='<p>Подключите открытый MCP в терминале:</p>'+code('codex mcp add krok --url '+url)+'<p>В новом чате Codex попросите вызвать list_clients.</p>';
  else if(kind==='claude')html='<p>В Claude откройте Customize → Connectors → Add custom connector. Вставьте адрес выше и выберите подключение без авторизации.</p>';
  else html='<p>В ChatGPT (при доступности пользовательских MCP) или другом MCP-клиенте добавьте указанный URL. Transport: Streamable HTTP. Authentication: No Authentication. Доступны только демонстрационные данные и 8 инструментов чтения.</p>';
 }
 else if(kind==='codex')html='<p>В терминале на компьютере с проектом выполните из папки vvv3:</p>'+code('codex mcp add krok -- "$(pwd)/.venv/bin/python" "$(pwd)/scripts/mcp_stdio.py"\ncodex mcp list')+'<p>Мост берёт ключ просмотра из локального .env. Откройте новый чат Codex и попросите вызвать list_clients. Ответ будет в Codex.</p><p>Для прямого HTTP-подключения задайте KROK_API_KEY в окружении процесса Codex (ключ просмотра из ACCESS.txt), затем:</p>'+code('codex mcp add krok-http --url '+url+' --bearer-token-env-var KROK_API_KEY')+'<p><a href="https://learn.chatgpt.com/docs/extend/mcp" target="_blank" rel="noopener noreferrer">Инструкция Codex MCP</a></p>';
 else if(kind==='claude')html='<p>После python3 scripts/setup.py добавьте секцию krok из claude-desktop-mcp.json в mcpServers конфигурации Claude Desktop (Settings → Developer → Edit Config). Перезапустите Claude Desktop.</p>'+code(JSON.stringify({mcpServers:{krok:{command:'/absolute/path/vvv3/.venv/bin/python',args:['/absolute/path/vvv3/scripts/mcp_stdio.py']}}},null,2))+'<p>Замените пути на абсолютные пути вашего проекта. На Windows: .venv\\Scripts\\python.exe. Ключ просмотра читается из .env мостом; в JSON он не нужен. Для удалённого сервера задайте мосту KROK_MCP_URL.</p>';
 else html='<p>Transport: Streamable HTTP. Укажите адрес выше и Authorization: Bearer &lt;ключ просмотра&gt; в защищённых настройках вашего MCP-клиента. Если он поддерживает только stdio, используйте scripts/mcp_stdio.py.</p><p>Порядок проверки: initialize → notifications/initialized → tools/list → tools/call (list_clients). Сервер предоставляет 8 инструментов только для чтения. OAuth не реализован.</p>';
 target.innerHTML=html+'<p class="small muted">'+(local?'Этот адрес доступен только с компьютера, где работает сервер. Для удалённого клиента нужен доступный ему HTTPS-адрес и PUBLIC_HOSTS.':'Для внешнего клиента проверьте доступность этого адреса из его сети и настройку PUBLIC_HOSTS.')+' Сервер приложения должен работать; Ollama не требуется.</p>';
}
async function checkAgent(){
 agentController?.abort();const controller=new AbortController();agentController=controller;
 const status=$('#agent-status'),button=dialog.querySelector('[data-action="check-agent"]');if(!status)return;
 status.textContent='Проверяю MCP…';button.disabled=true;
 const timer=setTimeout(()=>controller.abort(),5000);
 try{
  const headers={...(state.me?.public_demo?{}:{'Authorization':'Bearer '+state.key}),'Content-Type':'application/json','Accept':'application/json, text/event-stream'};
  async function rpc(method,params,id){
   const r=await fetch(agentMcpPath(),{method:'POST',headers,signal:controller.signal,body:JSON.stringify({jsonrpc:'2.0',id,method,params})});
   if(!r.ok)throw new Error(r.status===401?'Ключ не принят (401).':'MCP ответил HTTP '+r.status+'.');
   const body=await r.json();if(body.error||!body.result)throw new Error('Некорректный ответ MCP.');return body.result;
  }
  const init=await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'krok-availability-check',version:'1'}},1);
  headers['MCP-Protocol-Version']=init.protocolVersion;
  const ready=await fetch(agentMcpPath(),{method:'POST',headers,signal:controller.signal,body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized',params:{}})});
  if(!ready.ok)throw new Error('MCP не подтвердил инициализацию (HTTP '+ready.status+').');
  const result=await rpc('tools/list',{},2);
  const expected=['list_clients','get_client_map','get_contact','get_client_history','get_client_context','get_source','list_sources','get_site_help'];
  if(!expected.every(name=>result.tools?.some(t=>t.name===name))||result.tools.length!==8)throw new Error('Сервер ответил, но набор из 8 инструментов не подтверждён.');
  if(status.isConnected&&agentController===controller)status.textContent='MCP доступен · 8 инструментов · '+new Date().toLocaleTimeString('ru-RU')+'. Подключение агента не проверено.';
 }catch(e){if(status.isConnected&&agentController===controller)status.textContent=e.name==='AbortError'?'MCP не ответил за 5 секунд. Проверьте сервер и сеть.':e.message==='Failed to fetch'?'Сервер недоступен из браузера.':e.message}
 finally{clearTimeout(timer);if(button.isConnected&&agentController===controller)button.disabled=false}
}

function updateGraphSelection(){document.querySelectorAll('.graph .person').forEach(el=>{const selected=el.dataset.person===state.selected&&!state.edge;el.classList.toggle('selected',selected);el.setAttribute('aria-pressed',String(selected))});document.querySelectorAll('.graph .edge').forEach(el=>el.classList.toggle('selected',el.dataset.edge===state.edge))}
function softenContactChange(){
 if(reducedMotion.matches||mobileQuery.matches&&mobilePanel!=='contact'||state.collapsed.contact)return;
 const body=$('#contact-panel .contact-body');
 if(!body)return;
 body.getAnimations().forEach(animation=>animation.cancel());
 body.animate([{opacity:.75},{opacity:1}],{duration:150,easing:motionEase});
}
function selectPerson(id){const changed=state.selected!==id||Boolean(state.edge);state.selected=id;state.edge=null;state.detail=null;updateGraphSelection();renderContact();if(changed)softenContactChange();if(mobileQuery.matches&&mobilePanel!=='contact')mobileSheet('contact');loadDetail()}
function selectEdge(id){const changed=state.edge!==id;state.edge=id;state.detail=null;updateGraphSelection();renderContact();if(changed)softenContactChange();if(mobileQuery.matches&&mobilePanel!=='contact')mobileSheet('contact')}
async function setScope(scope,id){if(state.scope===scope&&(state.scopeId||null)===(id||null))return;state.scope=scope;state.scopeId=id||null;state.edge=null;if(scope==='person'&&id)state.selected=id;await loadMap();loadChat()}
function stopHistory(){clearTimeout(historyTimer);historyPending=false}
function historyCaption(version=state.graph.version){
 const h=state.history.find(h=>Number(h.version)===version);
 const latest=version===versions().at(-1);
 const actions={'client.created':'Создана карта','person.created':'Добавлен контакт','person.updated':'Изменён контакт','relation.created':'Добавлена связь','relation.reviewed':'Проверена связь','source.created':'Добавлен источник','deal.created':'Добавлена сделка','deal.updated':'Изменена сделка','interaction.created':'Добавлено взаимодействие'};
 const stages=['ИТ: новый контакт и встреча','Закупки: укрепление отношений','Аналитика: новый контакт','Добавлена сделка по аналитике','Финансы: согласование плана','ИБ: укрепление отношений','ИТ: развитие отношений','Маркетинг: согласование плана'];
 const label=h?.action?.startsWith('demo.stage.')?'Демо · '+(stages[Number(h.action.split('.').pop())-1]||h.action):actions[h?.action]||h?.action||'Снимок карты';
 return (latest?'Текущая версия':'Версия '+version+' · только просмотр')+' · '+label+(h?' · '+date(h.event_at||h.created_at):'');
}
function previewHistory(index){
 const vs=versions(),version=vs[index],slider=$('#timeline'),label=$('.timeline-label');
 if(version==null||!slider||!label)return;
 const caption=historyCaption(version);
 slider.value=String(vs.length===1?1:index);
 slider.setAttribute('aria-valuetext',caption);
 slider.style.setProperty('--progress',(vs.length>1?index/(vs.length-1)*100:50)+'%');
 label.textContent=caption;
 label.classList.toggle('historical',index!==vs.length-1);
}
async function setVersion(index){
 const vs=versions();if(index<0||index>=vs.length||!state.client)return;
 clearTimeout(historyTimer);
 const token=++state.graphEpoch,epoch=state.epoch,version=vs[index];
 historyPending=true;previewHistory(index);renderContact();renderAssistant();
 const q=params();q.set('version',version);
 try{
  const g=await api(path('/map?')+q);
  if(token!==state.graphEpoch||epoch!==state.epoch)return;
  state.version=index===vs.length-1?null:version;state.graph=g;state.edge=null;state.detail=null;historyPending=false;
  if(!g.nodes.some(n=>n.id===state.selected))state.selected=g.nodes[0]?.id||null;
  renderMap();loadDetail();loadChat();
 }catch(e){if(token!==state.graphEpoch||epoch!==state.epoch)return;stopHistory();renderMap();throw e}
}
function filters(){const f=state.filter,departments=[...new Set(state.fullPeople.map(p=>p.department).filter(Boolean))];formModal('Фильтры карты','<label>Поиск<input name="q" value="'+esc(f.q||'')+'" placeholder="Имя или должность"></label><label>Подразделение<select name="department"><option value="">Все</option>'+departments.map(x=>'<option '+(x===f.department?'selected':'')+'>'+esc(x)+'</option>').join('')+'</select></label><label>Отношения<select name="relationship"><option value="">Все</option>'+Object.entries(R).map(([k,v])=>'<option value="'+k+'" '+(f.relationship===k?'selected':'')+'>'+v+'</option>').join('')+'</select></label><label>Статус связи<select name="status"><option value="">Все</option><option value="confirmed" '+(f.status==='confirmed'?'selected':'')+'>Подтверждено</option><option value="proposed" '+(f.status==='proposed'?'selected':'')+'>Предложено</option></select></label>',async data=>{state.filter=Object.fromEntries(data);await loadMap()},'Применить')}
function legend(){modal('Как читать карту','<div class="detail-list">'+Object.entries(R).map(([k,v],i)=>'<div class="detail-item"><b>'+ (i+1)+'-е кольцо</b> · '+esc(v)+'</div>').join('')+'<p class="status-note">Чем ближе контакт к центру, тем устойчивее отношения. Толщина связи отражает её силу, пунктир обозначает предложение, которое ещё не подтверждено. История отображает сохранённые версии карты.</p></div>')}
function factItems(){
 const e=edge(),p=person(),related=state.detail?.relations||state.graph.edges.filter(x=>x.source===p?.id||x.target===p?.id).map(x=>x.data);
 const list=e?e.evidence:[...(p?.evidence||[]),...related.flatMap(x=>x.evidence||[]),...(state.detail?.interactions||[]).filter(x=>x.source_id).map(x=>({source_id:x.source_id,quote:''}))];
 return [...new Map((list||[]).map(x=>[x.source_id+'|'+x.quote,x])).values()];
}
let factDialogEpoch=0;
function externalSourceLink(url){
 try{const u=new URL(url);if(!['http:','https:'].includes(u.protocol))return '';return '<a class="fact-external" href="'+esc(u.href)+'" target="_blank" rel="noopener noreferrer">Открыть исходный документ</a>'}catch{return ''}
}
async function verify(sourceId=null){
 const items=factItems(),refs=factRefs(),ids=sourceId?[sourceId]:[...new Set(items.map(x=>x.source_id))];
 if(!ids.length){modal('Проверка факта','<p class="muted">Для выбранного факта нет подтверждающего источника.</p>');return}
 if(sourceId&&!refs[sourceId])return;
 const id=state.client.id,version=state.graph.version,epoch=state.epoch,token=++factDialogEpoch;
 modal('Проверка факта','<p class="muted">Загрузка источников…</p>');
 const el=$('#dialog-content');
 const results=await Promise.all(ids.map(async source_id=>{try{return {source_id,s:await api('/clients/'+encodeURIComponent(id)+'/sources/'+encodeURIComponent(source_id)+'?version='+version)}}catch{return {source_id,s:null}}}));
 if(token!==factDialogEpoch||epoch!==state.epoch||!dialog.open||$('#dialog-title').textContent!=='Проверка факта')return;
 el.innerHTML='<p class="small muted">Источники версии '+version+'. Наличие документа не означает, что вывод проверен.</p><div class="detail-list">'+results.map(({source_id,s})=>'<div class="detail-item"><b>'+esc(s?.title||'Источник недоступен')+'</b><p class="small muted">'+esc(s?date(s.source_date):'')+'</p>'+items.filter(x=>x.source_id===source_id&&x.quote).map(x=>'<blockquote>«'+esc(x.quote)+'»</blockquote>').join('')+(s?'<details><summary>Полный источник</summary><p>'+esc(s.text)+'</p></details>'+externalSourceLink(s.url):'')+'</div>').join('')+'</div>';
}
function interactions(){const list=state.detail?.interactions||[],refs=factRefs();modal('История взаимодействий','<div class="detail-list">'+(list.length?list.map(x=>factInteraction(x,refs)).join(''):'<p class="muted">Нет записей</p>')+'</div>')}

let proposalItems=[],proposalEpoch=0;
const proposalStatus={open:'Открыто',merged:'Принято',rejected:'Отклонено'};
const proposalFields={name:'Имя',title:'Должность',department:'Подразделение',relationship:'Отношения',is_decision_maker:'ЛПР',communication_notes:'Рабочие заметки',email:'Почта',phone:'Телефон',status:'Статус',kind:'Тип связи',description:'Описание',strength:'Сила связи'};
const proposalKinds={'contact.create':'Новый контакт','contact.update':'Правка контакта','relation.create':'Новая связь','relation.review':'Проверка связи'};
function proposalValue(k,v){
 if(v===undefined||v===null||v==='')return 'Не указано';
 if(k==='status')return S[v]||v;
 if(k==='relationship')return R[v]||v;
 if(k==='kind')return K[v]||v;
 if(typeof v==='boolean')return v?'Да':'Нет';
 return String(v).replace(/^Демонстрационный сценарий:\s*/i,'');
}
function proposalTag(status){return '<span class="proposal-status '+esc(status)+'">'+esc(proposalStatus[status]||status)+'</span>'}
async function openProposals(){
 if(!state.client)return;
 const client=state.client.id,token=++proposalEpoch;
 modal('Предложения CRM','<p class="muted">Загрузка предложений…</p>');
 try{
  const r=await api('/clients/'+encodeURIComponent(client)+'/proposals');
  if(token!==proposalEpoch||state.client?.id!==client||!dialog.open||$('#dialog-title').textContent!=='Предложения CRM')return;
  proposalItems=r.items;
  const counts=proposalItems.filter(x=>x.status==='open').length;
  $('#dialog-content').innerHTML='<div class="proposal-intro"><p>Изменения попадут в CRM только после проверки. Каждое принятие создаёт новую версию карты.</p><span>'+counts+' открыто · '+(proposalItems.length-counts)+' рассмотрено</span></div>'+
  (editor()&&current()?'<div class="proposal-toolbar"><button class="pill secondary" data-action="proposal-add">Новый контакт</button><button class="pill secondary" data-action="proposal-source">Добавить источник</button></div>':'<p class="fact-note">'+(!editor()?'Принимать изменения может редактор.':'Для внесения изменений вернитесь к текущей версии.')+'</p>')+
  '<div class="proposal-list">'+(proposalItems.length?proposalItems.map(p=>'<button class="proposal-row" data-action="proposal-view:'+esc(encodeURIComponent(p.id))+'"><div class="proposal-row-top"><b>'+esc(p.title)+'</b>'+proposalTag(p.status)+'</div><span class="fact-note">'+esc(p.author)+' · '+esc(date(p.created_at))+' · '+p.changes.length+' изм.</span></button>').join(''):'<p class="muted">Нет предложений. Добавьте источник или предложите правку контакта.</p>')+'</div>'+(state.client.crm_id==='demo-'+state.client.id?'<p class="fact-note proposal-data-note">Учебные данные · не сведения о реальных сотрудниках.</p>':'');
 }catch(e){if(token===proposalEpoch&&dialog.open)$('#dialog-content').innerHTML='<p class="error">'+esc(e.message)+'</p>'}
}
function proposalDiff(c){
 const keys=Object.keys(c.after).filter(k=>Object.hasOwn(proposalFields,k)&&!(k==='status'&&Object.hasOwn(c.after,'description')));
 const diff=keys.map(k=>'<div class="proposal-field"><span class="fact-label">'+esc(proposalFields[k])+'</span>'+(Object.hasOwn(c.before,k)?'<div class="proposal-minus">− '+esc(proposalValue(k,c.before[k]))+'</div>':'')+'<div class="proposal-plus">+ '+esc(proposalValue(k,c.kind==='relation.create'&&k==='status'?'confirmed':c.after[k]))+'</div></div>').join('');
 return '<article class="proposal-change"><span class="fact-label">'+esc(proposalKinds[c.kind]||c.kind)+'</span><b>'+esc(c.target)+'</b>'+(c.description?'<p>'+esc(c.description)+'</p>':'')+diff+(c.source?'<div class="proposal-evidence"><span class="fact-label">Источник · '+esc(date(c.source.date))+'</span><b>'+esc(c.source.id===state.client.id+'-source'&&c.source.title==='Тестовый протокол встречи'?'Протокол встречи':c.source.title)+'</b><blockquote>«'+esc(c.source.quote)+'»</blockquote></div>':'<p class="fact-note">Источник не указан · ручное предложение</p>')+'</article>';
}
function viewProposal(id){
 const p=proposalItems.find(x=>x.id===id);if(!p)return;
 modal('Предложение CRM','<button class="more proposal-back" data-action="proposals">← Все предложения</button><div class="proposal-intro"><div class="proposal-row-top"><h3>'+esc(p.title)+'</h3>'+proposalTag(p.status)+'</div><p class="fact-note">'+esc(p.author)+' · '+esc(date(p.created_at))+' · базовая версия '+p.base_version+'</p>'+(p.reason?'<p>'+esc(p.reason)+'</p>':'')+'</div><div class="proposal-list">'+p.changes.map(proposalDiff).join('')+'</div>'+
 (p.status==='open'&&editor()&&current()?'<p class="fact-note">Проверьте все изменения. Принятие применит весь набор одной транзакцией.</p><div class="error" id="proposal-error" role="alert"></div><div class="proposal-toolbar"><button class="pill secondary" data-action="proposal-reject:'+esc(encodeURIComponent(id))+'">Отклонить</button><button class="pill primary" data-action="proposal-merge:'+esc(encodeURIComponent(id))+'">Принять в CRM</button></div>':p.status==='open'?'<p class="fact-note">Решение доступно редактору в текущей версии карты.</p>':'<p class="fact-note">'+esc(proposalStatus[p.status])+' · '+esc(p.reviewed_by||'')+' · '+esc(date(p.reviewed_at))+(p.merged_version?' · версия '+p.merged_version:'')+'</p>'));
}
async function decideProposal(id,decision){
 if(!editor()||!current())return;
 const client=state.client.id,buttons=[...dialog.querySelectorAll('[data-action^="proposal-merge:"],[data-action^="proposal-reject:"]')];
 buttons.forEach(b=>b.disabled=true);
 try{
  await api('/clients/'+encodeURIComponent(client)+'/proposals/'+encodeURIComponent(id)+'/decision',{method:'POST',body:JSON.stringify({decision})});
  if(state.client?.id!==client)return;
  if(decision==='merge')await refresh();
  toast(decision==='merge'?'Изменения приняты в CRM':'Предложение отклонено');
  await openProposals();
 }catch(e){const error=$('#proposal-error');if(error)error.textContent=e.status===409?'Конфликт изменений. Создайте новое предложение или отклоните текущее.':e.message;else fail(e)}
 finally{buttons.forEach(b=>b.disabled=false)}
}
async function personForm(add=false){
 const p=add?{}:person();if(!p||!editor()||!current())return;
 const client=state.client.id,version=state.graph.version;
 const sources=await api(path('/sources'));
 if(state.client?.id!==client||!current()||state.graph.version!==version)return;
 formModal(add?'Предложить новый контакт':'Предложить правку','<label>Имя<input name="name" required maxlength="500" value="'+esc(p.name||'')+'"></label><label>Должность<input name="title" value="'+esc(p.title||'')+'"></label><label>Подразделение<input name="department" value="'+esc(p.department||'')+'"></label><label>Отношения<select name="relationship">'+Object.entries(R).map(([k,v])=>'<option value="'+k+'" '+((p.relationship||'unknown')===k?'selected':'')+'>'+v+'</option>').join('')+'</select></label><label>ЛПР<select name="is_decision_maker"><option value="false">Нет</option><option value="true" '+(p.is_decision_maker?'selected':'')+'>Да</option></select></label><label>Особенности общения<textarea name="communication_notes">'+esc(p.communication_notes||'')+'</textarea></label><label>Обоснование<textarea name="reason" maxlength="4000" placeholder="Что изменилось и почему?"></textarea></label><label>Источник (необязательно)<select name="source_id"><option value="">Ручное предложение</option>'+sources.items.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.title)+' · '+esc(date(s.source_date))+'</option>').join('')+'</select></label><label>Точная цитата из источника<textarea name="quote" maxlength="4000"></textarea></label><p class="status-note">CRM не изменится до принятия предложения.</p>',async f=>{
  const data=Object.fromEntries(f),reason=data.reason,source_id=data.source_id||null,quote=data.quote;
  delete data.reason;delete data.source_id;delete data.quote;data.is_decision_maker=data.is_decision_maker==='true';
  await api('/clients/'+encodeURIComponent(client)+'/proposals',{method:'POST',body:JSON.stringify({expected_version:version,person_id:p.id||null,changes:data,reason,source_id,quote})});
  toast('Предложение создано');await openProposals();
 },'Создать предложение');
}
function review(){const e=edge();if(!e||!editor()||!current())return;formModal('Рассмотреть связь','<label>Решение<select name="status">'+Object.entries(S).map(([k,v])=>'<option value="'+k+'" '+(e.status===k?'selected':'')+'>'+v+'</option>').join('')+'</select></label><label>Описание<textarea name="description">'+esc(e.description||'')+'</textarea></label>',async f=>{await api(path('/relations/'+encodeURIComponent(e.id)+'/review'),{method:'PATCH',body:JSON.stringify({expected_version:state.graph.version,...Object.fromEntries(f)})});await refresh();toast('Статус связи сохранён')})}
async function refresh(){const [p,d,h,c]=await Promise.all([api(path('/people')),api(path('/deals')),api(path('/history')),api(path())]);state.fullPeople=p.items;state.deals=d.items;state.history=h.items;state.client=c;state.version=null;await loadMap()}
async function clientSources(){renderDock('sources');if(!state.client){modal('Источники','<p class="muted">Сначала выберите клиента, чтобы просмотреть связанные источники.</p>');return}modal('Источники','<p class="muted">Загрузка…</p>');const r=await api(path('/sources'));if(!dialog.open||$('#dialog-title').textContent!=='Источники')return;$('#dialog-content').innerHTML='<div class="detail-list">'+(r.items.length?r.items.map(x=>'<button class="detail-item" data-source="'+esc(x.id)+'" style="text-align:left"><b>'+esc(x.title)+'</b><div class="small muted">'+esc(date(x.source_date))+'</div></button>').join(''):'<p class="muted">Нет источников</p>')+(editor()&&current()?'<button class="pill primary" data-action="add-source">Добавить источник</button>':'')+'</div>'}
async function showSource(id){const s=await api(path('/sources/'+encodeURIComponent(id)));modal(s.title,'<div class="detail-list"><div class="detail-item">'+esc(s.text)+'</div>'+(editor()&&current()?'<button class="pill" data-process="'+esc(id)+'">Подготовить предложения из источника</button>':'')+'</div>')}
function addSource(){if(!state.client||!editor()||!current())return;formModal('Добавить источник','<label>Название<input name="title" required maxlength="500"></label><label>Тип<select name="kind"><option value="protocol">Протокол</option><option value="research">Исследование</option><option value="crm">CRM</option><option value="document">Документ</option><option value="manual">Вручную</option></select></label><label>Текст<textarea name="text" required maxlength="100000"></textarea></label>',async f=>{await api(path('/sources?expected_version='+state.graph.version),{method:'POST',body:JSON.stringify({...Object.fromEntries(f),source_date:new Date().toISOString()})});await refresh();toast('Источник добавлен')})}
async function processSource(id){const b=dialog.querySelector('[data-process]');if(b)b.disabled=true;const clientId=state.client.id;try{const r=await api(path('/sources/'+encodeURIComponent(id)+'/process'),{method:'POST'});toast('Источник поставлен в очередь');const jobId=r.id||r.job_id;if(!jobId)return;for(let i=0;i<25;i++){await new Promise(resolve=>setTimeout(resolve,1000));if(state.client?.id!==clientId)return;const j=await api('/jobs/'+encodeURIComponent(jobId));if(['succeeded','completed','done','failed','error'].includes(j.status)){if(['failed','error'].includes(j.status))toast('Обработка не удалась');else{toast('Предложения готовы к проверке');await openProposals()}return}}toast('Обработка продолжается на сервере')}finally{if(b)b.disabled=false}}
async function action(a){if(a==='proposals')return openProposals();if(a==='proposal-add')return personForm(true);if(a==='proposal-source')return addSource();if(a?.startsWith('proposal-view:'))return viewProposal(decodeURIComponent(a.slice(14)));if(a?.startsWith('proposal-merge:'))return decideProposal(decodeURIComponent(a.slice(15)),'merge');if(a?.startsWith('proposal-reject:'))return decideProposal(decodeURIComponent(a.slice(16)),'reject');if(a?.startsWith('fact-source:'))return verify(decodeURIComponent(a.slice(12)));if(a==='crm-record')return crmRecord();if(a?.startsWith('mg-'))return mgAction(a);switch(a){case 'map':return showClients();case 'settings':return mgSettings();case 'connect-agent':return connectAgent();case 'check-agent':return checkAgent();case 'copilot-summary':return sendChat('Сводка по выбранному контексту',{intent:'summary'});case 'copilot-recommendations':return sendChat('Что проверить и какие данные уточнить?',{intent:'recommendations'});case 'copilot-help':return sendChat('Помощь по интерфейсу',{intent:'help'});case 'copilot-compare':return compareVersions();case 'sources':return mgOverview();case 'next-client':{const i=state.clients.findIndex(c=>c.id===state.client.id);return openClient(state.clients[(i+1)%state.clients.length].id)}case 'mobile-contact':return mobileSheet('contact');case 'mobile-assistant':return mobileSheet('assistant');case 'mobile-close':mobilePanel='';return applyMobile();case 'mobile-list':return mobileContacts();case 'zoom-in':return mobileScale(.25);case 'zoom-out':return mobileScale(-.25);case 'zoom-fit':return mobileScale(0);case 'toggle-assistant':if(mobileQuery.matches)return mobileSheet('assistant');state.collapsed.assistant=!state.collapsed.assistant;return renderAssistant();case 'toggle-contact':if(mobileQuery.matches)return mobileSheet('contact');state.collapsed.contact=!state.collapsed.contact;return renderContact();case 'filters':return filters();case 'legend':return legend();case 'verify':return verify();case 'interactions':return interactions();case 'edit-person':return personForm();case 'add-person':return personForm(true);case 'review':return review();case 'add-source':return addSource();case 'prev-version':stopHistory();return setVersion(Number($('#timeline').value)-1);case 'next-version':stopHistory();return setVersion(Number($('#timeline').value)+1)}}
document.addEventListener('click',ev=>{const el=ev.target.closest('[data-action],[data-close],[data-client],[data-person],[data-edge],[data-scope],[data-source],[data-process],[data-mobile-person]');if(!el||el.disabled)return;const d=el.dataset;try{let r;if('close'in d){dialog.close();return}if(d.mobilePerson){dialog.close();r=selectPerson(d.mobilePerson)}else if(d.client)r=openClient(d.client);else if(d.person)r=selectPerson(d.person);else if(d.edge)r=selectEdge(d.edge);else if(d.scope){const id=d.scope==='deal'?state.deals[0]?.id:d.scope==='person'?(state.selected||state.fullPeople[0]?.id):null;r=setScope(d.scope,id)}else if(d.source)r=showSource(d.source);else if(d.process)r=processSource(d.process);else r=action(d.action);Promise.resolve(r).catch(fail)}catch(e){fail(e)}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&mobilePanel&&!dialog.open){mobilePanel='';applyMobile();return}if((e.key==='Enter'||e.key===' ')&&e.target.matches('svg [role="button"]')){e.preventDefault();const d=e.target.dataset;if(d.person)selectPerson(d.person);if(d.edge)selectEdge(d.edge)}});
document.addEventListener('change',e=>{if(e.target.id==='agent-client')agentInstructions();if(e.target.id==='scope-select')setScope(state.scope,e.target.value).catch(fail);if(e.target.id==='timeline'){stopHistory();setVersion(Number(e.target.value)).catch(fail)}});
document.addEventListener('input',e=>{if(e.target.id==='timeline'){stopHistory();state.graphEpoch++;const t=e.target,index=Number(t.value);historyPending=true;previewHistory(index);renderContact();renderAssistant();historyTimer=setTimeout(()=>setVersion(index).catch(fail),70)}if(e.target.id==='chat-input')chatState().draft=e.target.value});
document.addEventListener('submit',e=>{if(e.target.id==='chat-form'){e.preventDefault();sendChat($('#chat-input').value)}});
dialog.addEventListener('close',()=>{agentController?.abort();renderDock(app.querySelector('.management-screen')?.dataset.section||'map')});
(async()=>{
 renderDock();
 try{
  try{state.me=await api('/me')}
  catch(e){
   if(e.status!==401||!state.key)throw e;
   state.key='';sessionStorage.removeItem('krok_api_key');
   state.me=await api('/me');
  }
  await showClients();
 }catch(e){if(e.status===401)settings(true);else{app.innerHTML='<div class="error-screen">'+esc(e.message)+'<p>Обновите страницу для повторного подключения.</p></div>'}}
})();
