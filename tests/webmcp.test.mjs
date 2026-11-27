import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const script=readFileSync(new URL('../frontend/ui-assets/webmcp.js',import.meta.url),'utf8');

async function load(kind='document'){
 const tools=new Map(),requests=[];
 let ready;
 const host={registerTool:async t=>tools.set(t.name,t),waitForToolsUntil:p=>{ready=p}};
 const sandbox={document:kind==='document'?{modelContext:host}:{},navigator:kind==='navigator'?{modelContext:host}:{},console,AbortController,setTimeout,clearTimeout,fetch:async(url,options)=>{
  const body=JSON.parse(options.body);
  requests.push({url,options,body});
  return {ok:true,json:async()=>({result:body.method==='initialize'?{protocolVersion:'2025-03-26'}:{structuredContent:{items:[]}}})};
 }};
 vm.runInNewContext(script,sandbox);
 await ready;
 await new Promise(resolve=>setImmediate(resolve));
 return {tools,requests};
}
test('registers exactly eight read-only site tools with modern and legacy API',async()=>{
 for(const kind of ['document','navigator']){
  const {tools}=await load(kind);
  assert.equal(tools.size,8);
  assert.ok([...tools.values()].every(t=>t.annotations.readOnlyHint));
 }
 assert.equal((await load('none')).tools.size,0);
});
test('uses public MCP only; invalid parameters cannot reach server',async()=>{
 const {tools,requests}=await load();
 await assert.rejects(tools.get('get_client_map').execute({client_id:'private'}));
 await assert.rejects(tools.get('get_client_map').execute({client_id:'vtb',version:0}));
 await assert.rejects(tools.get('list_clients').execute({extra:'secret'}));
 assert.equal(requests.length,0);
 const result=await tools.get('get_client_map').execute({client_id:'vtb',version:2});
 assert.equal(JSON.parse(result.content[0].text).dataset,'synthetic_demo');
 assert.deepEqual(requests.map(r=>r.body.method),['initialize','notifications/initialized','tools/call']);
 assert.ok(requests.every(r=>r.url==='/mcp-demo/'&&r.options.credentials==='omit'&&!('Authorization' in r.options.headers)));
 assert.equal(requests[2].body.params.name,'get_client_map');
 assert.deepEqual(requests[2].body.params.arguments,{client_id:'vtb',version:2});
});
