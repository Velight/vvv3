import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Api,ApiError} from '../frontend/api.js';
test('scoped request encodes identifiers without putting the key in URL',async()=>{
 const api=new Api('test-secret');let observed;
 globalThis.fetch=async(url,opts)=>{observed={url,opts};return {ok:true,json:async()=>({nodes:[]})};};
 await api.get('client/a','/map',{scope:'person',scope_id:'id&other=x',version:null});
 assert.equal(observed.url,'/api/v1/clients/client%2Fa/map?scope=person&scope_id=id%26other%3Dx');
 assert.equal(observed.opts.headers['X-API-Key'],'test-secret');
 assert.ok(!observed.url.includes('test-secret'));
});
test('failed writes are not retried or reported as success',async()=>{
 for(const status of [401,403,409,422,502]){
  let calls=0;globalThis.fetch=async()=>{calls++;return{ok:false,status,json:async()=>({detail:'failure'})};};
  await assert.rejects(new Api('x').write('c','/people/p',{expected_version:1,changes:{name:'New'}},'PATCH'),e=>e instanceof ApiError&&e.status===status);
  assert.equal(calls,1);
 }
});
test('network failures and cancellation stay distinguishable',async()=>{
 globalThis.fetch=async()=>{throw new Error('offline');};
 await assert.rejects(new Api().request('/me'),/Нет связи/);
 globalThis.fetch=async()=>{throw new DOMException('Aborted','AbortError');};
 await assert.rejects(new Api().request('/me'),e=>e.name==='AbortError');
});
