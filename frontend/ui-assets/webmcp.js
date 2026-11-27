/* WebMCP site tools: the existing public, read-only MCP dataset only. */
(() => {
 'use strict';
 const host = document.modelContext || navigator.modelContext;
 if (!host || typeof host.registerTool !== 'function') return;
 const string = {type:'string',minLength:1,maxLength:500};
 const client = {type:'string',enum:['krasnodar','vtb','mvideo','s7']};
 const version = {type:'integer',minimum:1};
 const scope = {type:'string',enum:['client','deal','person']};
 const scoped = {client_id:client,scope,scope_id:string,version};
 const schema = (properties,required=[]) => ({type:'object',properties,required,additionalProperties:false});
 const definitions = [
  ['list_clients','Список демонстрационных клиентов и поиск по названию.',schema({query:{type:'string',maxLength:500},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:200}})],
  ['get_client_map','Карта контактов и связей клиента; можно указать сохранённую версию.',schema(scoped,['client_id'])],
  ['get_contact','Контакт, его должность, связи и сведения из выбранной версии карты.',schema({client_id:client,person_id:string,version},['client_id','person_id'])],
  ['get_client_history','Сохранённые версии карты и даты изменений.',schema({client_id:client},['client_id'])],
  ['get_client_context','Данные клиента, сделки или контакта для анализа и рекомендаций.',schema(scoped,['client_id'])],
  ['get_source','Текст демонстрационного источника для проверки фактов.',schema({client_id:client,source_id:string},['client_id','source_id'])],
  ['list_sources','Список доступных демонстрационных источников клиента.',schema({client_id:client},['client_id'])],
  ['get_site_help','Справка по интерфейсу и инструментам карты ЛПР.',schema({topic:{type:'string',maxLength:500}})]
 ];
 // Each call uses a separate stateless MCP handshake. No private API key,
 // cookies, local storage, account token, or arbitrary endpoint is forwarded.
 async function call(name,args){
  const headers={'Content-Type':'application/json','Accept':'application/json, text/event-stream'};
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),15000);
  async function rpc(method,params,id){
   const body={jsonrpc:'2.0',method,params};
   if(id!==undefined)body.id=id;
   const response=await fetch('/mcp-demo/',{method:'POST',headers,credentials:'omit',cache:'no-store',signal:controller.signal,body:JSON.stringify(body)});
   if(!response.ok)throw new Error('Public MCP: HTTP '+response.status);
   if(id===undefined)return;
   const payload=await response.json();
   if(payload.error||!payload.result)throw new Error('Public MCP request failed');
   return payload.result;
  }
  try{
   const init=await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'krok-webmcp',version:'1.0'}},1);
   headers['MCP-Protocol-Version']=init.protocolVersion;
   await rpc('notifications/initialized',{});
   const result=await rpc('tools/call',{name,arguments:args},2);
   if(result.isError)throw new Error('Запрос отклонён публичным MCP');
   // The server returns structured data; text content is a compatibility fallback.
   return {content:[{type:'text',text:JSON.stringify({dataset:'synthetic_demo',data:result.structuredContent??result.content})}]};
  }finally{clearTimeout(timer)}
 }
 function validate(args,inputSchema){
  if(args===undefined)args={};
  if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('Expected object arguments');
  for(const key of inputSchema.required)if(!Object.hasOwn(args,key))throw new Error('Missing '+key);
  const clean={};
  for(const [key,value] of Object.entries(args)){
   if(!Object.hasOwn(inputSchema.properties,key))throw new Error('Unknown argument '+key);
   const p=inputSchema.properties[key];
   if(p.type==='string'&&(typeof value!=='string'||value.length<(p.minLength??0)||value.length>(p.maxLength??500)))throw new Error('Invalid '+key);
   if(p.type==='integer'&&(!Number.isSafeInteger(value)||value<(p.minimum??0)||value>(p.maximum??Number.MAX_SAFE_INTEGER)))throw new Error('Invalid '+key);
   if(p.enum&&!p.enum.includes(value))throw new Error('Invalid '+key);
   clean[key]=value;
  }
  return clean;
 }
 async function register(){
  for(const [name,description,inputSchema] of definitions){
   await host.registerTool({name,description:description+' Только чтение синтетических демо-данных. Предложенные связи не являются подтверждёнными фактами.',inputSchema,annotations:{readOnlyHint:true,untrustedContentHint:true},execute:async args=>call(name,validate(args,inputSchema))});
  }
 }
 const ready=register().catch(error=>console.warn('WebMCP registration:',error));
 if(typeof host.waitForToolsUntil==='function')host.waitForToolsUntil(ready);
})();
