import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { neonStore } from '../storage.mjs';
import { handleRequest } from '../handler.mjs';
import { operate,initialState } from '../operations.mjs';
import { defaults } from '../moderation.mjs';
import { registrationFor } from '../registration.mjs';
const identity={adminToken:'test-combined-admin',secret:'test-combined-hook',uuid:'test-id'};
const event=(id,text='You are an idiot.',sender='@speaker:local')=>({botUserId:'@bot:local',displayName:'Test speaker',event:{type:'m.room.message',room_id:'!test:local',event_id:id,sender,content:{msgtype:'m.text',body:text}}});

test('existing Bouncer state acquires moderation defaults without changing lists or decisions',async()=>{
 const original=initialState();delete original.moderation;
 original.approved=[{id:'kept',phone:'+447700900101',issues:[]}];original.decisions={kept:{note:'Existing decision'}};
 const result=await operate(original,{method:'GET',url:new URL('https://example/api/state'),headers:{authorization:`Bearer ${identity.adminToken}`},input:{}},identity);
 assert.equal(result.code,200);assert.equal(result.changed,false);assert.equal(result.data.moderation.config.mode,'demo');
 assert.deepEqual(result.state.approved,original.approved);assert.deepEqual(result.state.decisions,original.decisions);
 assert.equal(original.moderation,undefined);
});

test('one registration subscribes to both event types and preserves its module identity',()=>{
 const registration=registrationFor(identity,'https://auto-bouncer.vercel.app','/webhook');
 assert.equal(registration.id,'bouncer');assert.equal(registration.secret,identity.secret);
 assert.deepEqual(registration.event_types,['m.room.member','m.room.message']);
});

test('hosted combined webhook, demo/live rules, reviews and concurrency persist in Postgres',async()=>{
 const pg=new PGlite();
 try{
  await pg.exec(await fs.readFile(new URL('../db/setup.sql',import.meta.url),'utf8'));
  const sql={query:async(text,params)=>(await pg.query(text,params)).rows};
  let store=neonStore(sql,'combined-test');
  const call=async(route,data,admin=true)=>{
   const res=await handleRequest(new Request('https://example'+route,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(admin?{Authorization:`Bearer ${identity.adminToken}`}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),{store,identity,hosted:true,origin:'https://example'});
   return {code:res.status,data:await res.json()};
  };
  const hook='/api/index?__route=/&hook='+identity.secret;
  assert.equal((await call('/api/moderation/config',defaults(),false)).code,401);
  assert.equal((await call('/api/demo',{})).code,200);
  let snapshot=(await call('/api/state')).data;
  assert.equal(snapshot.rows.length,6);assert.equal(snapshot.moderation.incidents.length,3);
  assert.equal(snapshot.moderation.incidents.filter(i=>i.status==='false-positive').length,1);
  assert.equal((await call('/api/moderation/config',{...defaults(),mode:'live'})).code,400);
  await call('/api/demo/reset',{});assert.equal((await call('/api/state')).data.moderation.incidents.length,0);
  assert.equal((await call('/api/moderation/config',{...defaults(),mode:'live'})).code,400);
  await call('/api/settings',{roomId:'!test:local',country:'GB',exemptUserIds:['@service:local']});
  const config={...defaults(),mode:'live',rooms:['!other:local']};
  assert.equal((await call('/api/moderation/config',config)).code,200);
  snapshot=(await call('/api/state')).data;assert.deepEqual(snapshot.moderation.config.rooms,['!test:local']);
  const simulated=await call('/api/moderation/simulate',{text:'idiot',sender:'@service:local'});assert.ok(simulated.data.ignored);
  assert.equal((await call('/api/state')).data.moderation.incidents.length,0);
  const duplicate=await Promise.all([call(hook,event('$same'),false),call(hook,event('$same'),false)]);
  assert.ok(duplicate.every(r=>r.code===200));assert.equal(duplicate.filter(r=>r.data.response.message).length,1);
  const concurrent=await Promise.all([call(hook,event('$next'),false),call(hook,event('$third'),false)]);
  assert.equal(concurrent.filter(r=>r.data.response.message).length,0);
  assert.equal((await call('/api/state')).data.moderation.incidents.length,3);
  const foreign=event('$foreign');foreign.event.room_id='!other:local';
  assert.equal((await call(hook,foreign,false)).data.reason,'Room is not enabled');
  const member={event:{type:'m.room.member',room_id:'!test:local',event_id:'$join',state_key:'@speaker:local',sender:'@admin:local',content:{membership:'join'}}};
  assert.equal((await call(hook,member,false)).code,200);
  snapshot=(await call('/api/state')).data;assert.equal(snapshot.rows.length,1);assert.equal(snapshot.rows[0].userId,'@speaker:local');
  const id=snapshot.moderation.incidents[0].id;
  assert.equal((await call(`/api/moderation/incidents/${id}/review`,{status:'false-positive',note:''})).code,400);
  assert.equal((await call(`/api/moderation/incidents/${id}/review`,{status:'false-positive',note:'Reviewed in context; acceptable quotation.'})).code,200);
  store=neonStore(sql,'combined-test');
  const persisted=(await call('/api/state')).data;
  assert.equal(persisted.moderation.incidents.find(i=>i.id===id).status,'false-positive');
  assert.equal(persisted.rows.length,1);
  assert.equal((await call(hook,event('$same'),false)).data.reason,'Duplicate event');
  const exported=(await call('/api/report')).data;assert.equal(exported.moderation.incidents.length,3);
  assert.equal(exported.moderation.seen,undefined);assert.equal(exported.moderation.lastWarnings,undefined);
  assert.ok(exported.audit.some(a=>a.action==='moderation-review'));
 }finally{await pg.close();}
});
