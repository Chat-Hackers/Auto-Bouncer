import { digest, normalizePhone } from './bouncer.mjs';

const validUserId = value => typeof value === 'string' && value.length <= 300 && /^@[^\s:]+:[^\s]+$/.test(value);

// This is trusted Hub enrichment, never a display name or user-editable event.content field.
export function bridgeParticipant(value, country, expectedUserId) {
  if (!value || !validUserId(value.userId) || expectedUserId && value.userId !== expectedUserId) {
    throw Error('Hub participant must identify the membership target');
  }
  const raw = value.phoneSource === 'bridge' && typeof value.phoneNumber === 'string' ? value.phoneNumber.trim() : '';
  if (raw.length > 100) throw Error('Hub phone number is too long');
  const phone = normalizePhone(raw, country);
  return { userId: value.userId, name: typeof value.name === 'string' ? value.name.slice(0, 300) : '',
    phoneRaw: raw, phone: phone.number, phoneError: phone.error || null, phoneSource: raw ? 'bridge' : 'unavailable' };
}

export function applyMemberSnapshot(state, payload) {
  if (state.isDemo) throw Error('Clear the labelled demo before syncing a real group');
  if (!state.settings.roomId || payload?.roomId !== state.settings.roomId) throw Error('Hub returned a different group');
  if (payload.complete !== true || !Array.isArray(payload.members) || payload.members.length > 5000) {
    throw Error('Hub must return a complete member list of at most 5,000 entries');
  }
  const at = Date.parse(payload.observedAt);
  if (!Number.isFinite(at) || at > Date.now() + 30000) throw Error('Hub snapshot needs a valid observedAt timestamp');
  if (state.rosterSync && at <= Date.parse(state.rosterSync.observedAt)) throw Error('Hub snapshot is older than the last sync; try again');
  const members = payload.members.map(member => bridgeParticipant(member, state.settings.country));
  const ids = new Set(members.map(member => member.userId));
  if (ids.size !== members.length) throw Error('Hub returned duplicate participant identities');
  if (new Set([...state.participants.map(p => p.userId || p.id), ...ids]).size > 5000) throw Error('Participant limit reached; archive a snapshot first');
  for (const member of members) {
    const prior = state.participants.find(p => p.userId === member.userId);
    if (prior?.eventTs > at) continue; // A join/leave received while fetching wins over this snapshot.
    const mapped = !member.phoneRaw && prior?.phone && prior.source.startsWith('csv') ?
      { ...member, phoneRaw: prior.phoneRaw, phone: prior.phone, phoneError: prior.phoneError, phoneSource: 'csv' } : member;
    const participant = { ...mapped, id: prior?.id || digest(['matrix', payload.roomId, member.userId]).slice(0, 20),
      name: member.name || prior?.name || '', source: mapped.phoneSource === 'csv' ? 'csv + Hub roster' : 'Hub roster',
      reference: prior?.reference || '', issues: [], membership: 'join', eventTs: at };
    if (prior) Object.assign(prior, participant); else state.participants.push(participant);
  }
  for (const prior of state.participants) {
    if (prior.userId && !ids.has(prior.userId) && !(prior.eventTs > at)) {
      prior.membership = 'leave'; prior.eventTs = at;
    }
  }
  const missing = members.filter(member => !member.phone).length;
  state.rosterSync = { observedAt: new Date(at).toISOString(), at: new Date().toISOString(), count: members.length, missingNumbers: missing };
  state.audit.push({ at: state.rosterSync.at, action: 'hub-members-synced', rows: members.length });
  return state.rosterSync;
}

export async function fetchMemberSnapshot(hubOrigin, roomId, secret, fetcher = fetch) {
  if (!hubOrigin) throw Error('Set HUB_URL in Vercel and redeploy. Your Hub operator must enable the members API described in HUB-MEMBERS.md.');
  const url = new URL(hubOrigin);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw Error('HUB_URL must be an HTTPS origin, such as https://dev.dashboard.chathackers.uk');
  }
  url.pathname = '/api/members';
  url.searchParams.set('roomId', roomId); url.searchParams.set('toolId', 'whatsapp-bouncer');
  let response;
  try { response = await fetcher(url, { headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15000) }); }
  catch { throw Error('Could not reach the Hub members API. Ask your Hub operator to check the connection.'); }
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
    throw Error('Hub members API is unavailable or denied access. Ask your Hub operator to enable the API in HUB-MEMBERS.md and activate Bouncer in this room.');
  }
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 1500000) { await reader.cancel(); throw Error('Hub member response is too large'); }
    chunks.push(Buffer.from(value));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Error('Hub members API returned invalid JSON'); }
}

export const DEFAULT_HUB_URL = 'https://dev.dashboard.chathackers.uk';

// The Hub's POST /api/kick (tool-hub 3933e9b) authenticates with the module secret in the
// query string and answers before Matrix confirms; the later leave event confirms removal.
export async function sendKicks(hubOrigin, roomId, secret, kicks, fetcher = fetch) {
  const url = new URL('/api/kick', hubOrigin || DEFAULT_HUB_URL);
  url.searchParams.set('roomId', roomId); url.searchParams.set('toolId', 'whatsapp-bouncer'); url.searchParams.set('secret', secret);
  return Promise.all(kicks.map(async ({ userId, reason }) => {
    try {
      const response = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ userId, reason }), redirect: 'error', signal: AbortSignal.timeout(10000) });
      const result = await response.json().catch(() => ({}));
      return response.ok && result.success === true ? { userId, ok: true } : { userId, ok: false, error: String(result.message || `Hub answered ${response.status}`).slice(0, 300) };
    } catch { return { userId, ok: false, error: 'Could not reach the Hub' }; }
  }));
}
