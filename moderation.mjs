export const warningText = 'Moderator note: please keep the conversation respectful. A message has been flagged for organiser review. A word match can miss context; no one has been removed.';
export const defaults = () => ({
  mode: 'demo',
  rooms: [],
  exemptSenders: [],
  cooldownSeconds: 300,
  warning: warningText,
  rules: [
    { id: 'personal-insult', phrase: 'idiot', action: 'warn', enabled: true, exceptions: [] },
    { id: 'aggressive-language', phrase: 'shut up', action: 'review', enabled: true, exceptions: [] }
  ]
});
export const normalize = text => String(text).normalize('NFKC').toLowerCase().replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/gu, ' ').trim();
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function containsPhrase(text, phrase) {
  const needle = normalize(phrase);
  if (!needle) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escape(needle)}(?![\\p{L}\\p{N}_])`, 'u').test(normalize(text));
}
export function validateConfig(input) {
  if (!input || !['demo', 'live'].includes(input.mode)) throw Error('Choose demo or live mode');
  const list = (value, label) => {
    if (!Array.isArray(value) || value.length > 100 || value.some(s => typeof s !== 'string' || !s.trim() || s.length > 300)) throw Error(`${label}: use up to 100 nonempty entries`);
    return [...new Set(value.map(s => s.trim()))];
  };
  const rooms = list(input.rooms, 'Room IDs');
  if (rooms.some(s => !s.startsWith('!'))) throw Error('Matrix room IDs must start with !');
  if (input.mode === 'live' && !rooms.length) throw Error('Add at least one allowed room before enabling live mode');
  const exemptSenders = list(input.exemptSenders, 'Exempt senders');
  if (!Number.isInteger(input.cooldownSeconds) || input.cooldownSeconds < 10 || input.cooldownSeconds > 86400) throw Error('Warning cooldown must be 10–86,400 seconds');
  if (typeof input.warning !== 'string' || input.warning.trim().length < 5 || input.warning.length > 1000) throw Error('Warning must contain 5–1,000 characters');
  if (!Array.isArray(input.rules) || input.rules.length > 100) throw Error('Use up to 100 rules');
  const ids = new Set();
  const rules = input.rules.map(r => {
    if (!r || typeof r.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(r.id) || ids.has(r.id)) throw Error('Each rule needs a unique id');
    ids.add(r.id);
    if (typeof r.phrase !== 'string' || !normalize(r.phrase) || r.phrase.length > 200) throw Error('Each rule needs a phrase of 1–200 characters');
    if (!['review', 'warn'].includes(r.action)) throw Error('Supported actions: review or warn');
    if (typeof r.enabled !== 'boolean') throw Error('Rule enabled must be true or false');
    return { id:r.id, phrase:r.phrase.trim(), action:r.action, enabled:r.enabled, exceptions:list(r.exceptions, 'Rule exceptions') };
  });
  return { mode:input.mode, rooms, exemptSenders, cooldownSeconds:input.cooldownSeconds, warning:input.warning.trim(), rules };
}
export function evaluate(event, config, botUserId) {
  if (!event || event.type !== 'm.room.message' || !['m.text','m.notice'].includes(event.content?.msgtype)) return { ignored:'Not a text message', matches:[] };
  if (typeof event.room_id !== 'string' || typeof event.sender !== 'string' || typeof event.event_id !== 'string' || !event.event_id || event.event_id.length > 500 || event.room_id.length > 300 || event.sender.length > 300) throw Error('Text events require room_id, sender and event_id');
  if (event.sender === botUserId || event.content?.context?.autoModerator || event.content?.context?.moduleEvent || config.exemptSenders.includes(event.sender)) return { ignored:'Bot or exempt sender', matches:[] };
  const content = event.content?.['m.relates_to']?.rel_type === 'm.replace' ? event.content['m.new_content'] : event.content;
  if (typeof content?.body !== 'string' || content.body.length > 20000) throw Error('Message body must be text under 20,000 characters');
  let text = content.body;
  if (content['m.relates_to']?.['m.in_reply_to']) text = text.replace(/^(?:>[^\n]*\n)+\n?/, '');
  const matches=[], exceptions=[];
  for(const rule of config.rules) {
    if(!rule.enabled || !containsPhrase(text,rule.phrase)) continue;
    const exception=rule.exceptions.find(phrase=>containsPhrase(text,phrase));
    if(exception) exceptions.push({ruleId:rule.id,phrase:exception});
    else matches.push({ruleId:rule.id,phrase:rule.phrase,action:rule.action});
  }
  return { text, matches, exceptions };
}
