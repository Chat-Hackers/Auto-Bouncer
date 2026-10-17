import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { neonStore,optimisticStore } from '../storage.mjs';
import { handleRequest } from '../handler.mjs';
import { initialState } from '../operations.mjs';
import hosted from '../api/index.mjs';
const identity={adminToken:'test-admin-token-for-hosted-tests',secret:'test-module-secret-for-hosted-tests',uuid:'00000000-0000-4000-8000-000000000001'};
test('hosted routes persist in Postgres and concurrent joins preserve both members',async()=>{
 const pg=new PGlite();
 try{
  await pg.exec(await fs.readFile(new URL('../db/setup.sql',import.meta.url),'utf8'));
  const sql={query:async(text,params)=>(await pg.query(text,params)).rows};
  const store=neonStore(sql,'test-production');
  const context={store,identity,origin:'https://bouncer.example',hosted:true};
  const call=async(route,data,auth=true)=>{
   const req=new Request('https://bouncer.example'+route,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${identity.adminToken}`}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
   const response=await handleRequest(req,context);return {code:response.status,data:await response.json()};
  };
  assert.equal((await call('/api/index?__route=/api/state',undefined,false)).code,401);
  const registration=await call('/api/index?__route=/api/registration');
  assert.equal(new URL(registration.data.url).pathname,'/webhook');assert.equal(registration.data.secret,identity.secret);
  assert.equal((await call('/api/index?__route=/api/settings',{roomId:'!test:local',country:'GB',exemptUserIds:[]})).code,200);
  const join=n=>({event:{type:'m.room.member',event_id:'$join'+n,room_id:'!test:local',sender:'@inviter:local',state_key:`@participant${n}:local`,origin_server_ts:Date.now(),content:{membership:'join'}}});
  const hook='/api/index?__route=/&hook='+identity.secret;
  const responses=await Promise.all([call(hook,join(1),false),call(hook,join(2),false)]);
  assert.deepEqual(responses.map(r=>r.code),[200,200]);
  const recreated=neonStore(sql,'test-production');assert.equal((await recreated.read()).participants.length,2);
  assert.equal((await call(hook,join(1),false)).data.reason,'Duplicate event');
  const isolated=neonStore(sql,'test-preview');assert.equal((await isolated.read()).participants.length,0);
  const state=(await call('/api/index?__route=/api/state')).data;assert.equal(state.rows.length,2);assert.ok(state.rows.every(r=>r.status==='missing-number'));
  const row=state.rows[0];const review=await call(`/api/index?__route=/api/participants/${row.id}/review`,{signature:row.signature,outcome:'awaiting-check',note:'Test organiser awaiting verified phone mapping.'});assert.equal(review.code,200);
  assert.equal((await recreated.read()).decisions[row.id].outcome,'awaiting-check');
 }finally{await pg.close();}
});
test('hosted entrypoint fails closed without deployment configuration',async()=>{
 const names=['DATABASE_URL','ADMIN_TOKEN','MODULE_SECRET','BOUNCER_INSTANCE_ID'];const old=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 for(const n of names)delete process.env[n];
 try{const response=await hosted.fetch(new Request('https://example.org/api/state'));assert.equal(response.status,503);assert.ok((await response.json()).error.includes('setup incomplete'));}
 finally{for(const n of names)if(old[n]===undefined)delete process.env[n];else process.env[n]=old[n];}
});
test('failed validation and exhausted concurrency never save a partial operation',async()=>{
 let committed=false;
 const store=optimisticStore({load:async()=>({revision:0,data:initialState()}),compareAndSwap:async()=>{committed=true;return false;}},2);
 await assert.rejects(()=>store.update(async state=>{state.participants.push({});throw Error('Rejected');}),/Rejected/);assert.equal(committed,false);
 await assert.rejects(()=>store.update(async state=>({code:200,data:{},state,changed:true})),error=>error.status===409);
});
