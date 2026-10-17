import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../handler.mjs';
import { optimisticStore } from '../storage.mjs';
import { initialState } from '../operations.mjs';
const identity={adminToken:'test-admin-token-for-kick-tests',secret:'test-module-secret-for-kick-tests',uuid:'00000000-0000-4000-8000-000000000002'};
function setup(answer={success:true}){
 let saved={revision:0,data:initialState()};const sent=[];
 const store=optimisticStore({load:async()=>structuredClone(saved),compareAndSwap:async(revision,data)=>{if(revision!==saved.revision)return false;saved={revision:revision+1,data:structuredClone(data)};return true;}});
 const hubFetch=async(url,options)=>{sent.push({url:new URL(url),body:JSON.parse(options.body)});return new Response(JSON.stringify(answer),{headers:{'Content-Type':'application/json'}});};
 const context={store,identity,origin:'https://bouncer.example',hubOrigin:'https://hub.example',hubFetch};
 const call=async(route,data,auth=true)=>{const response=await handleRequest(new Request('https://bouncer.example'+route,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${identity.adminToken}`}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),context);return {code:response.status,data:await response.json()};};
 const hook=(payload)=>call('/?hook='+identity.secret,{botUserId:'@bot:test',...payload},false);
 const join=(userId,n)=>hook({event:{type:'m.room.member',event_id:'$j'+n,room_id:'!room:test',sender:userId,state_key:userId,origin_server_ts:Date.now()+n,content:{membership:'join'}}});
 return {call,hook,join,sent,state:()=>saved.data};
}
async function configure(t,autoKick){
 assert.equal((await t.call('/api/settings',{roomId:'!room:test',country:'GB',exemptUserIds:['@whatsapp_447700900900:test'],autoKick})).code,200);
 const csv='phone,name\n07700 900101,Approved';const preview=await t.call('/api/import/preview',{kind:'approved',csv});
 assert.equal((await t.call('/api/import/apply',{kind:'approved',csv,expectedVersion:preview.data.version})).code,200);
}
test('auto-remove kicks bridged joiners not on the list and spares everyone else',async()=>{
 const t=setup();await configure(t,'unlisted');
 await t.join('@whatsapp_447700900101:test',1);
 await t.join('@whatsapp_447700900102:test',2);
 await t.join('@whatsapp_lid-99:test',3);
 await t.join('@organiser:test',4);
 await t.join('@whatsapp_447700900900:test',5);
 assert.deepEqual(t.sent.map(s=>s.body.userId),['@whatsapp_447700900102:test']);
 const {url}=t.sent[0];assert.equal(url.pathname,'/api/kick');assert.equal(url.searchParams.get('roomId'),'!room:test');assert.equal(url.searchParams.get('toolId'),'bouncer');assert.equal(url.searchParams.get('secret'),identity.secret);
 assert.equal(t.state().participants.find(p=>p.userId==='@whatsapp_447700900102:test').kick.status,'sent');
});
test('strict mode also removes hidden numbers; off mode removes nobody',async()=>{
 const strict=setup();await configure(strict,'strict');await strict.join('@whatsapp_lid-99:test',1);await strict.join('@organiser:test',2);
 assert.deepEqual(strict.sent.map(s=>s.body.userId),['@whatsapp_lid-99:test']);
 const off=setup();await configure(off,'off');await off.join('@whatsapp_447700900102:test',1);assert.equal(off.sent.length,0);
});
test('organiser remove button and live remove rules send one kick; failures are reported',async()=>{
 const t=setup({success:false,message:'module is not active in this room'});await configure(t,'off');
 await t.join('@whatsapp_447700900102:test',1);
 const row=(await t.call('/api/state')).data.rows.find(r=>r.userId==='@whatsapp_447700900102:test');
 const result=await t.call(`/api/participants/${row.id}/kick`,{});assert.equal(result.code,502);assert.match(result.data.error,/not active/);
 assert.equal(t.state().participants.find(p=>p.id===row.id).kick.status,'failed');
 const config=t.state().moderation.config;config.mode='live';config.rules[0].action='remove';
 assert.equal((await t.call('/api/moderation/config',config)).code,200);
 await t.hook({displayName:'X',event:{type:'m.room.message',event_id:'$m1',room_id:'!room:test',sender:'@whatsapp_447700900103:test',origin_server_ts:Date.now(),content:{msgtype:'m.text',body:'you idiot'}}});
 assert.deepEqual(t.sent.map(s=>s.body.userId),['@whatsapp_447700900102:test','@whatsapp_447700900103:test']);
 assert.ok(t.state().participants.some(p=>p.userId==='@whatsapp_447700900103:test'&&p.source==='seen in chat'));
});
