import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bridgeParticipant, applyMemberSnapshot, fetchMemberSnapshot } from '../hub-members.mjs';
import { initialState, operate } from '../operations.mjs';
import { prepareImport, report } from '../bouncer.mjs';
import { handleRequest } from '../handler.mjs';
import { optimisticStore } from '../storage.mjs';

const identity = { adminToken: 'private-admin-test', secret: 'private-webhook-test' };
const member = (userId = '@a:test', phoneNumber = '+447700900101') => ({ userId, phoneNumber, phoneSource: 'bridge', name: 'Example' });
const setup = () => {
  const state = initialState(); state.settings.roomId = '!room:test';
  state.approved = prepareImport('approved', 'phone,name,reference\n07700900101,A,A'); return state;
};
const snapshot = members => ({ roomId: '!room:test', complete: true, observedAt: new Date(Date.now() - 1000).toISOString(), members });
const event = (id, content = {}) => ({ type: 'm.room.member', room_id: '!room:test', state_key: '@a:test', sender: '@admin:test', event_id: id, origin_server_ts: Date.now(), content: { membership: 'join', ...content } });

test('only trusted bridge fields supply phone numbers, never display names or opaque IDs', () => {
  assert.equal(bridgeParticipant(member(), 'GB').phone, '+447700900101');
  assert.equal(bridgeParticipant({ ...member(), phoneSource: 'displayname' }, 'GB').phone, null);
  assert.equal(bridgeParticipant({ userId: '@whatsapp_447700900101:test', name: '+447700900101' }, 'GB').phone, null);
  assert.throws(() => bridgeParticipant(member(), 'GB', '@other:test'), /target/);
});

test('complete roster compares approved, unmatched, unavailable and duplicate numbers', () => {
  const state = setup();
  applyMemberSnapshot(state, snapshot([member(), member('@b:test', '+447700900199'), member('@lid:test', null)]));
  assert.deepEqual(report(state).map(row => row.status), ['on-list', 'needs-review', 'missing-number']);
  assert.equal(state.rosterSync.missingNumbers, 1);
  const newer = snapshot([member(), member('@b:test', '+447700900101')]); newer.observedAt = new Date().toISOString();
  applyMemberSnapshot(state, newer);
  assert.deepEqual(report(state).map(row => row.status), ['ambiguous', 'ambiguous', 'left']);
});

test('partial, wrong-room, duplicate-identity and stale snapshots cannot change membership', () => {
  const state = setup(); const before = structuredClone(state);
  for (const payload of [{ ...snapshot([]), complete: false }, { ...snapshot([]), roomId: '!other:test' }, snapshot([member(), member()])]) {
    assert.throws(() => applyMemberSnapshot(state, payload)); assert.deepEqual(state, before);
  }
  const payload = snapshot([member()]); applyMemberSnapshot(state, payload);
  assert.throws(() => applyMemberSnapshot(state, payload), /older/);
});

test('newer membership events win and number changes invalidate organiser decisions', () => {
  const state = setup(); applyMemberSnapshot(state, snapshot([member()]));
  const row = report(state)[0]; state.decisions[row.id] = { outcome: 'guest-exception', signature: row.signature };
  const payload = snapshot([member('@a:test', '+447700900199')]); payload.observedAt = new Date().toISOString();
  applyMemberSnapshot(state, payload);
  assert.equal(report(state)[0].status, 'needs-review'); assert.ok(report(state)[0].previousDecision);
  state.participants[0].eventTs = Date.now() + 10000; state.participants[0].membership = 'leave';
  const next = { ...payload, observedAt: new Date(Date.now() + 10).toISOString() };
  applyMemberSnapshot(state, next); assert.equal(state.participants[0].membership, 'leave');
});

test('webhook enrichment binds to state_key, ignores content phones and deduplicates', async () => {
  const run = (state, input) => operate(state, { method: 'POST', url: new URL('https://bouncer.test/?hook=' + identity.secret), headers: {}, input }, identity);
  let result = await run(setup(), { event: event('$plain', { phoneNumber: '+447700900101', displayname: '+447700900101' }) });
  assert.equal(result.state.participants[0].phone, null);
  result = await run(result.state, { event: event('$verified'), participant: member() });
  assert.equal(report(result.state)[0].status, 'on-list');
  const duplicate = await run(result.state, { event: event('$verified'), participant: member() });
  assert.equal(duplicate.data.reason, 'Duplicate event'); assert.equal(duplicate.state.participants.length, 1);
  await assert.rejects(() => run(result.state, { event: event('$wrong'), participant: member('@other:test') }), /target/);
});

test('Hub fetch uses server-side bearer auth, rejects redirects/errors and oversized bodies', async () => {
  await fetchMemberSnapshot('https://hub.example', '!room:test', identity.secret, async (url, options) => {
    assert.equal(url.pathname, '/api/members'); assert.equal(url.searchParams.get('roomId'), '!room:test');
    assert.equal(options.headers.Authorization, 'Bearer ' + identity.secret); assert.equal(url.toString().includes(identity.secret), false);
    assert.equal(options.redirect, 'error'); return Response.json(snapshot([member()]));
  });
  await assert.rejects(() => fetchMemberSnapshot('', '!room:test', identity.secret), /HUB_URL/);
  await assert.rejects(() => fetchMemberSnapshot('http://hub.example', '!room:test', identity.secret), /HTTPS/);
  await assert.rejects(() => fetchMemberSnapshot('https://hub.example', '!room:test', identity.secret, async () => new Response('Not found', { status: 404 })), /unavailable/);
  await assert.rejects(() => fetchMemberSnapshot('https://hub.example', '!room:test', identity.secret, async () => new Response(' '.repeat(1500001), { headers: { 'Content-Type': 'application/json' } })), /too large/);
});

test('sync route authenticates before fetching, ignores browser-supplied snapshots and persists Hub results', async () => {
  let data = setup(), revision = 0, fetchCount = 0;
  const store = optimisticStore({ load: async () => ({ revision, data: structuredClone(data) }), compareAndSwap: async (expected, next) => {
    if (expected !== revision) return false; data = structuredClone(next); revision++; return true;
  } });
  const context = { identity, store, hubOrigin: 'https://hub.example', hubFetch: async () => { fetchCount++; return Response.json(snapshot([member()])); } };
  const request = authenticated => new Request('https://bouncer.test/api/participants/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: 'Bearer ' + identity.adminToken } : {}) }, body: JSON.stringify(snapshot([member('@injected:test')])) });
  assert.equal((await handleRequest(request(false), context)).status, 401); assert.equal(fetchCount, 0);
  assert.equal((await handleRequest(request(true), context)).status, 200); assert.equal(fetchCount, 1);
  assert.deepEqual(data.participants.map(p => p.userId), ['@a:test']); assert.equal(report(data)[0].status, 'on-list');
});
