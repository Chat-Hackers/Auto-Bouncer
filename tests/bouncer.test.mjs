import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone,parseCSV,prepareImport,report,participantFromEvent } from '../bouncer.mjs';
const state=()=>({settings:{roomId:'!room:test',country:'GB',exemptUserIds:[]},approved:prepareImport('approved','phone,name,reference\n07700900101,A,A\n+447700900102,B,B'),participants:prepareImport('participants','phone,name,matrix_user_id\n00447700900101,A,@a:test\n07700900199,Unknown,@unknown:test\n,Opaque,@lid:test'),decisions:{}});
test('normalises UK local/international formats without guessing opaque identities',()=>{
 for(const input of ['07700 900101','+44 (0)7700 900101','0044-7700-900101','+44 7700 900101','44 7700 900101','447700900101'])assert.equal(normalizePhone(input).number,'+447700900101');
 assert.equal(normalizePhone('+1 (202) 555-0101','international').number,'+12025550101');
 for(const input of ['@whatsapp_1234:matrix.test','07700900101 ext 2','123','','+4407700900101'])assert.ok(normalizePhone(input).error);
 assert.ok(normalizePhone('07700900101','international').error);
});
test('CSV quoted fields, missing values and duplicate diagnostics',()=>{
 assert.equal(parseCSV('\uFEFFphone,name\r\n07700900101,"A, ""Example"""').rows[0].name,'A, "Example"');
 assert.throws(()=>parseCSV('phone,name\n123,"open'));
 assert.throws(()=>parseCSV('phone,phone\n123,456'));
 const entries=prepareImport('approved','phone,reference\n07700900101,A\n+447700900101,B\n,C');
 assert.ok(entries[0].issues.some(i=>i.includes('more than once')));assert.ok(entries[2].issues.length);
});
test('comparison distinguishes exact match, unmatched, missing and duplicate records',()=>{
 const data=state();assert.deepEqual(report(data).map(p=>p.status),['on-list','needs-review','missing-number']);
 data.approved.push({...data.approved[0]});assert.equal(report(data)[0].status,'ambiguous');
 data.approved.pop();data.participants.push({...data.participants[0],id:'duplicate'});assert.equal(report(data)[0].status,'ambiguous');
});
test('changed-number and guest decisions expire or become stale on list or identity change',()=>{
 const data=state(),row=report(data)[1];
 data.decisions[row.id]={outcome:'changed-number',linkedReference:'B',signature:row.signature,expiresAt:'2099-01-01T00:00:00Z'};
 assert.equal(report(data)[1].status,'changed-number');
 data.approved[0].name='Updated';assert.equal(report(data)[1].status,'needs-review');assert.ok(report(data)[1].previousDecision);
 const current=report(data)[1];data.decisions[current.id]={outcome:'guest-exception',signature:current.signature,expiresAt:'2000-01-01T00:00:00Z'};
 assert.equal(report(data)[1].status,'needs-review');
});
test('membership uses state_key, reads the number from the bridge ID and never from display names',()=>{
 const data=state();const event={type:'m.room.member',room_id:'!room:test',sender:'@admin:test',state_key:'@whatsapp_447700900101:test',event_id:'$join',content:{membership:'join',displayname:'+447700900199'}};
 const participant=participantFromEvent(event,data.settings,[]);assert.equal(participant.userId,event.state_key);assert.equal(participant.phone,'+447700900101');assert.equal(participant.phoneSource,'bridge-id');
 event.state_key='@whatsapp_lid-123456:test';assert.equal(participantFromEvent(event,data.settings,[]).phone,null);
 event.state_key='@a:test';assert.equal(participantFromEvent(event,data.settings,data.participants).phone,'+447700900101');
 event.room_id='!other:test';assert.equal(participantFromEvent(event,data.settings,[]),null);
});
