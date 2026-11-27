/* Sources and settings: browser UI over the existing authenticated API. */
'use strict';
const mgDefaults={evidence:true,confirm:true,auto:true,verified:false,changes:true,errors:true};
function mgRead(key,fallback){try{const value=JSON.parse(localStorage.getItem(key));return value&&typeof value==='object'&&!Array.isArray(value)?value:fallback}catch{return fallback}}
let mgPrefs={...mgDefaults,...mgRead('krok.ui.preferences',{})};
mgPrefs.confirm=true;
let mgTools=mgRead('krok.ui.tools',{});
function mgSave(){try{localStorage.setItem('krok.ui.preferences',JSON.stringify(mgPrefs));localStorage.setItem('krok.ui.tools',JSON.stringify(mgTools))}catch{}}
const mgIcon=(type)=>{
 const paths={crm:'<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="12" cy="10" r="2.5"/><path d="M7.5 17c0-4 9-4 9 0"/>',mail:'<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/>',calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 10h18"/>',docs:'<path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10H3z"/>',arrow:'<path d="m5 5 14 14m-9 0h9v-9"/>',back:'<path d="m15 5-7 7 7 7"/>',plus:'<path d="M12 5v14M5 12h14"/>'};
 return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[type]||'')+'</svg>';
};
const mgCatalog={
 crm:{title:'CRM',desc:'Контакты, компании и сделки',sources:[['Контакты','Имена, должности и роли в сделках','people'],['Компании','Карточки клиентов и ответственные менеджеры','clients'],['Сделки','Этапы, участники и история изменений','deals']],tools:[['Найти контакт','Поиск по имени, компании или должности','people'],['Открыть карточку клиента','Данные о компании и её контактах','clients'],['Получить историю сделки','Хронология этапов и участников','history']]},
 mail:{title:'Корпоративная почта',desc:'Переписка с клиентами',sources:[['Входящие','Сохранённые записи писем; направление не указано','email'],['Отправленные','Ответы команды и исходящие письма',null],['Папка «Клиенты»','Переписка по активным проектам',null]],tools:[['Найти письма','Поиск по сохранённым записям','email'],['Открыть цепочку','Переписка целиком и список участников',null],['Получить вложение','Документ из выбранного письма',null]]},
 calendar:{title:'Календарь',desc:'Встречи и участники',sources:[['Рабочий календарь','Сохранённые рабочие встречи','meeting'],['Календарь отдела продаж','Общие встречи команды',null]],tools:[['Найти встречи','Поиск по сохранённым встречам','meeting'],['Получить участников','Участники сохранённых встреч','participants'],['Открыть встречу','Дата, повестка и описание','meeting']]},
 docs:{title:'Документы',desc:'Протоколы и материалы проектов',sources:[['Протоколы встреч','Договорённости и ответственные','protocol'],['Проектные папки','Сохранённые материалы клиентов и сделок','document']],tools:[['Найти документ','Поиск по названию сохранённого источника','documentAll'],['Открыть документ','Текст сохранённого документа','documentAll'],['Получить ссылку на фрагмент','Источник для проверки факта','documentAll']]}
};
let mgSection='',mgId='',mgClient='',mgList=[],mgEpoch=0,mgLastVersions=new Map(),mgBusy=false;
function mgStart(section,id=''){
 stopHistory();mobilePanel='';mobileCentered=false;state.epoch++;state.graphEpoch++;
 mgSection=section;mgId=id;mgEpoch++;mgBusy=false;
 renderDock(section);
}
function mgActive(section,id=''){return app.querySelector('.management-screen')?.dataset.section===section&&mgSection===section&&mgId===id}
function mgHeader(title,description,extra=''){return '<header class="mg-header"><div><h1>'+esc(title)+'</h1><p>'+esc(description)+'</p></div>'+extra+'</header>'}
function mgShell(section,html){app.innerHTML='<section class="management-screen" data-section="'+section+'">'+html+'</section>';renderDock(section)}
function mgStatus(id){return id==='crm'?['Доступен','ok']:['Внешний сервис не подключён','offline']}
function mgDot(label,cls){return '<span class="mg-status '+cls+'"><span></span>'+esc(label)+'</span>'}
function mgToolEnabled(id,index){return mgTools[id+':'+index]!==false}
function mgSwitch(on,action,label,disabled=false){return '<button type="button" class="mg-switch" role="switch" aria-label="'+esc(label)+'" aria-checked="'+String(on)+'" data-action="'+esc(action)+'" '+(disabled?'disabled':'')+'><span></span></button>'}
function mgOverview(){
 if(!state.me)return settings(true);
 mgStart('sources');
 const cards=Object.entries(mgCatalog).map(([id,c])=>{
  const [status,cls]=mgStatus(id);
  const supported=c.sources.filter(x=>x[2]).length, tools=c.tools.filter((x,i)=>x[2]&&mgToolEnabled(id,i)).length;
  return '<button type="button" class="mg-card mg-catalog-card" data-action="mg-open:'+id+'"><div class="mg-card-top"><div><h2>'+esc(c.title)+'</h2><p>'+esc(c.desc)+'</p></div>'+mgIcon(id)+'</div><div class="mg-card-bottom">'+mgDot(status,cls)+'<span>'+supported+' '+noun(supported,['источник','источника','источников'])+'</span><span>'+tools+' '+noun(tools,['инструмент','инструмента','инструментов'])+'</span>'+mgIcon('arrow')+'</div></button>';
 }).join('');
 const extra='<button class="mg-pill" data-action="mg-connect">'+mgIcon('plus')+' Подключить</button>';
 mgShell('sources',mgHeader('Источники','4 категории данных · CRM и сохранённые записи',extra)+'<div class="mg-grid">'+cards+'</div>'+(state.client&&state.graph?'<div class="mg-footer"><button class="mg-pill" data-action="mg-client-sources">Источники клиента: '+esc(state.client.name)+'</button></div>':''));
}
function mgRows(id,items,isTool){
 return items.map(([name,desc,kind],i)=>{
  const enabled=Boolean(kind)&&(!isTool||mgToolEnabled(id,i));
  return '<div class="mg-row"><button type="button" class="mg-row-text" data-action="mg-browse:'+id+':'+(isTool?'t':'s')+':'+i+'" '+(!enabled?'disabled':'')+'><strong>'+esc(name)+'</strong><small>'+esc(desc)+'</small></button>'+(isTool?mgSwitch(enabled,'mg-tool:'+id+':'+i,name,!kind):'<span class="mg-source-dot '+(kind?'ok':'offline')+'" title="'+(kind?'Доступны сохранённые данные':'Нет интеграции')+'" aria-label="'+(kind?'Доступно':'Недоступно')+'"></span>')+'</div>';
 }).join('');
}
function mgDetail(id,focus=false){
 const c=mgCatalog[id];if(!c||!state.me)return;
 if(mgSection!=='sources'||mgId!==id||!mgActive('sources',id))mgStart('sources',id);
 const [status,cls]=mgStatus(id), options=mgList.map(x=>'<option value="'+esc(x.id)+'" '+(x.id===mgClient?'selected':'')+'>'+esc(x.name)+'</option>').join('');
 const statusBar='<div class="mg-statusbar">'+mgIcon(id)+mgDot(status,cls)+'<span class="mg-access">Доступ только для чтения</span><button class="mg-pill" data-action="mg-refresh" '+(mgBusy?'disabled':'')+'>'+(mgBusy?'Обновление…':'Обновить данные')+'</button></div>';
 const selector='<div class="mg-footer mg-detail-footer"><label>Клиент <select id="mg-client" aria-label="Клиент">'+(options||'<option value="">Нет доступных клиентов</option>')+'</select></label><span>Переключатели управляют доступом в интерфейсе, не правами сервера MCP.</span></div>';
 mgShell('sources',mgHeader(c.title,c.desc,'<button class="mg-back" data-action="sources" aria-label="К источникам">'+mgIcon('back')+'</button>')+statusBar+'<div class="mg-grid"><section class="mg-card mg-detail-card"><h2>Источники</h2><p>Данные, к которым есть доступ</p>'+mgRows(id,c.sources,false)+'</section><section class="mg-card mg-detail-card"><h2>Инструменты MCP</h2><p>Действия с данными в интерфейсе</p>'+mgRows(id,c.tools,true)+'</section></div>'+selector+(id!=='crm'?'<p class="mg-note">Внешняя интеграция не настроена. Доступны только записи, сохранённые в CRM.</p>':''));
 if(focus)app.querySelector('.mg-back')?.focus();
}
async function mgOpen(id){if(!mgCatalog[id]||!state.me)return;mgStart('sources',id);mgList=state.clients.slice();mgClient=state.client?.id||mgClient||mgList[0]?.id||'';mgDetail(id);await mgRefresh(false)}
async function mgRefresh(manual=true){
 if(!mgId||!mgActive('sources',mgId)||mgBusy)return;
 const token=mgEpoch,id=mgId;mgBusy=true;
 const button=app.querySelector('[data-action="mg-refresh"]');if(button){button.disabled=true;button.textContent='Обновление…'}
 try{
  const result=await api('/clients?limit=200');
  if(token!==mgEpoch||!mgActive('sources',id))return;
  const previous=mgLastVersions, next=new Map(result.items.map(x=>[x.id,x.version]));
  const changed=previous.size>0&&([...next].some(([key,value])=>previous.get(key)!==value)||previous.size!==next.size);
  mgLastVersions=next;mgList=result.items;
  if(!mgList.some(x=>x.id===mgClient))mgClient=mgList[0]?.id||'';
  if(mgClient){
   const base='/clients/'+encodeURIComponent(mgClient);
   const routes=id==='crm'?['/people','/deals']:id==='docs'?['/sources']:['/interactions'];
   await Promise.all(routes.map(suffix=>api(base+suffix)));
   if(token!==mgEpoch||!mgActive('sources',id))return;
  }
  if(manual)toast('Данные обновлены');else if(changed&&mgPrefs.changes)toast('Данные клиентов изменились');
 }catch(e){if(token!==mgEpoch||!mgActive('sources',id))return;if(e.status===401){fail(e);return}if(manual||mgPrefs.errors)toast(e.message||'Не удалось обновить данные')}
 finally{if(token===mgEpoch&&mgActive('sources',id)){mgBusy=false;mgDetail(id)}}
}
const mgSettingGroups=[['Ассистент',[['evidence','Показывать источники','Показывать цитаты и ссылки на подтверждения в карточках'],['confirm','Подтверждать правки','Сохранение правок требует явного подтверждения'],['auto','Обновлять данные автоматически','Проверять данные открытого источника раз в минуту']]],['Карта и уведомления',[['verified','Показывать только проверенные связи','Скрывать связи без подтверждённого статуса'],['changes','Сообщать об изменениях','Уведомлять об изменениях при обновлении источников'],['errors','Сообщать об ошибках подключения','Уведомлять об ошибках фонового обновления']]]];
function mgSettings(){
 if(!state.me)return settings(true);
 mgStart('settings');mgRenderSettings();
}
function mgRenderSettings(){
 const panels=mgSettingGroups.map(([title,items])=>'<section class="mg-card mg-settings-card"><h2>'+esc(title)+'</h2>'+items.map(([key,name,desc])=>'<div class="mg-row"><div class="mg-row-text"><strong>'+esc(name)+'</strong><small>'+esc(desc)+'</small></div>'+mgSwitch(Boolean(mgPrefs[key]),'mg-pref:'+key,name,key==='confirm')+'</div>').join('')+'</section>').join('');
 mgShell('settings',mgHeader('Настройки','Ассистент, карта связей и уведомления')+'<div class="mg-grid">'+panels+'</div><div class="mg-footer"><button class="mg-pill" data-action="mg-key">'+(state.me?.public_demo?'Вход редактора (необязательно)':'Ключ доступа к CRM')+'</button><span>Настройки сохраняются в этом браузере.</span></div>');
}
function mgConnect(){
 if(state.me?.public_demo){
  modal('Подключение источников','<p>Демонстрационная CRM доступна без ключа, только для просмотра. Подключите внешнего агента через публичный MCP <code>/mcp-demo/</code>.</p><p class="muted">Почта, календарь и внешнее хранилище не подключены.</p><div class="dialog-actions"><button class="pill" data-close>Закрыть</button></div>');
  return;
 }
 modal('Подключение источников','<p>CRM использует существующий API и ключ доступа. Сервер предоставляет MCP по адресу <code>/mcp/</code>.</p><p class="muted">Для подключения внешней почты, календаря и хранилища документов нужны серверные интеграции. В этой версии они не настроены.</p><div class="dialog-actions"><button class="pill" data-action="mg-key">Ключ доступа к CRM</button><button class="pill" data-close>Закрыть</button></div>');
}
function mgRecords(items,kind,client){
 if(!items.length)return '<p class="muted">Нет сохранённых записей для выбранного клиента.</p>';
 return '<div class="mg-records">'+items.map(x=>{
  const title=x.name||x.title||x.summary||x.id||'Запись';
  const details=[x.title!==title?x.title:'',x.department,x.stage,x.summary!==title?x.summary:'',x.occurred_at?date(x.occurred_at):'',x.source_date?date(x.source_date):'',x.person_ids?.length?'Участники: '+x.person_ids.join(', '):'',x.version!=null?'Версия: '+x.version:'',x.action].filter(Boolean).join(' · ');
  return '<div class="detail-item mg-record"><b>'+esc(title)+'</b><p class="small muted">'+esc(details)+'</p>'+(['protocol','document','documentAll'].includes(kind)?'<button class="pill" data-action="mg-document:'+encodeURIComponent(client)+':'+encodeURIComponent(x.id)+'">Открыть источник</button>':'')+'</div>';
 }).join('')+'</div>';
}
async function mgBrowse(id,type,index){
 const c=mgCatalog[id], row=(type==='t'?c?.tools:c?.sources)?.[index];if(!row?.[2]||type==='t'&&!mgToolEnabled(id,index))return;
 const [name,,kind]=row,client=mgClient,token=mgEpoch;
 if(kind!=='clients'&&!client){toast('Выберите клиента');return}
 modal(name,'<p class="muted">Загрузка…</p>');
 try{
  const base='/clients/'+encodeURIComponent(client);let data;
  if(kind==='clients')data=await api('/clients?limit=200');
  else if(['people','deals','history'].includes(kind))data=await api(base+'/'+kind);
  else if(['email','meeting','participants'].includes(kind)){data=await api(base+'/interactions');data.items=data.items.filter(x=>x.kind===(kind==='email'?'email':'meeting'));if(kind==='participants'){const people=await api(base+'/people'),ids=new Set(data.items.flatMap(x=>x.person_ids||[]));data.items=people.items.filter(x=>ids.has(x.id))}}
  else {data=await api(base+'/sources');data.items=data.items.filter(x=>kind==='documentAll'||x.kind===kind)}
  if(token!==mgEpoch||!dialog.open||$('#dialog-title').textContent!==name)return;
  $('#dialog-content').innerHTML='<label class="mg-search">Поиск<input id="mg-record-search" type="search" placeholder="Поиск по записям"></label>'+mgRecords(data.items||[],kind,client);
  $('#mg-record-search').addEventListener('input',e=>{const query=e.target.value.trim().toLocaleLowerCase('ru');for(const el of dialog.querySelectorAll('.mg-record'))el.hidden=!el.textContent.toLocaleLowerCase('ru').includes(query)});
 }catch(e){if(token!==mgEpoch||!dialog.open||$('#dialog-title').textContent!==name)return;$('#dialog-content').textContent=e.message||'Не удалось загрузить данные'}
}
async function mgDocument(client,id){
 const token=mgEpoch, data=await api('/clients/'+encodeURIComponent(client)+'/sources/'+encodeURIComponent(id));
 if(token===mgEpoch&&dialog.open)modal(data.title,'<div class="detail-item mg-document">'+esc(data.text)+'</div>');
}
function mgAction(a){
 const [name,id,index,extra]=a.split(':');
 switch(name){
  case 'mg-open':return mgOpen(id);
  case 'mg-connect':return mgConnect();
  case 'mg-key':return settings();
  case 'mg-refresh':return mgRefresh();
  case 'mg-client-sources':return clientSources();
  case 'mg-tool':{const row=mgCatalog[id]?.tools[Number(index)];if(!row?.[2])return;mgTools[id+':'+index]=!mgToolEnabled(id,Number(index));mgSave();mgDetail(id);app.querySelector('[data-action="'+a+'"]')?.focus();return}
  case 'mg-pref':if(Object.hasOwn(mgDefaults,id)&&id!=='confirm'){mgPrefs[id]=!mgPrefs[id];mgSave();mgRenderSettings();app.querySelector('[data-action="'+a+'"]')?.focus()}return;
  case 'mg-browse':return mgBrowse(id,index,Number(extra));
  case 'mg-document':return mgDocument(decodeURIComponent(id),decodeURIComponent(index));
 }
}
document.addEventListener('change',e=>{if(e.target.id==='mg-client'){mgClient=e.target.value;mgRefresh(false)}});
setInterval(()=>{if(mgPrefs.auto&&mgId&&mgActive('sources',mgId)&&!document.hidden)mgRefresh(false)},60000);
