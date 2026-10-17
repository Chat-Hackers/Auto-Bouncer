import { createHash } from 'node:crypto';
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function parseCSV(text) {
  if(typeof text!=='string'||text.length>1000000)throw Error('Choose a CSV under 1 MB');
  const rows=[];let row=[],cell='',quoted=false,closed=false;
  const push=()=>{row.push(cell.replace(/\r$/,''));if(row.some(s=>s.trim()))rows.push(row);row=[];cell='';closed=false;};
  text=text.replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){
      if(quoted&&text[i+1]==='"'){cell+='"';i++;}
      else if(quoted){quoted=false;closed=true;}
      else if(!cell&&!closed)quoted=true;
      else throw Error('Unexpected quote in CSV');
    }else if(c===','&&!quoted){row.push(cell);cell='';closed=false;}
    else if(c==='\n'&&!quoted)push();
    else if(closed&&c!=='\r')throw Error('Unexpected text after CSV quote');
    else cell+=c;
  }
  if(quoted)throw Error('Unclosed CSV quote');
  if(cell||row.length)push();
  const headers=rows.shift()?.map(s=>s.trim().toLowerCase());
  if(!headers?.length||headers.some(s=>!s)||new Set(headers).size!==headers.length)throw Error('CSV needs unique, nonempty column names');
  if(rows.length>5000)throw Error('Maximum 5,000 entries per list');
  return {headers,rows:rows.map((r,i)=>{if(r.length!==headers.length)throw Error(`Row ${i+2}: expected ${headers.length} columns`);return Object.fromEntries(headers.map((h,j)=>[h,r[j].trim()]));})};
}
export function normalizePhone(raw, country='GB') {
  if(raw===undefined||raw===null||!String(raw).trim())return {number:null,error:'No phone number supplied'};
  let value=String(raw).normalize('NFKC').trim();
  if(country==='GB')value=value.replace(/^(\+44|0044)\s*\(0\)/,'$1');
  if(/[^+\d\s().-]/.test(value))return {number:null,error:'Unsupported characters or extension; review the number'};
  value=value.replace(/[\s().-]/g,'');
  if(value.startsWith('00'))value='+'+value.slice(2);
  if(country==='GB'&&/^0[1-9]\d{9}$/.test(value))value='+44'+value.slice(1);
  if(!/^\+[1-9]\d{7,14}$/.test(value))return {number:null,error:'Use +countrycode or 00countrycode; UK local numbers need a leading 0'};
  if(value.startsWith('+44')&&!/^\+44[1-9]\d{9}$/.test(value))return {number:null,error:'Expected a standard 10-digit UK national number after +44'};
  return {number:value,error:null};
}
export function prepareImport(kind,csv,country='GB') {
  if(!['approved','participants'].includes(kind))throw Error('Choose approved or participants');
  const {headers,rows}=parseCSV(csv);
  if(kind==='approved'&&!headers.includes('phone'))throw Error('Approved CSV requires a phone column');
  if(kind==='participants'&&!headers.includes('phone')&&!headers.includes('matrix_user_id'))throw Error('Participant CSV needs phone or matrix_user_id');
  const entries=rows.map((r,i)=>{
    const phone=normalizePhone(r.phone,country);
    const userId=r.matrix_user_id||'';
    const issues=[];
    if(phone.error)issues.push(phone.error);
    if(userId&&!/^@[^\s:]+:[^\s]+$/.test(userId))issues.push('Invalid Matrix user ID');
    const reference=r.reference||'';
    return {id:digest([kind,userId||reference||phone.number||r.phone||'',i]).slice(0,20),name:(r.name||'').slice(0,300),phoneRaw:r.phone||'',phone:phone.number,phoneError:phone.error,userId,reference,row:i+2,issues,source:'csv',membership:'join'};
  });
  const numbers=new Map(),refs=new Map(),users=new Map();
  for(const e of entries){if(e.phone)numbers.set(e.phone,(numbers.get(e.phone)||0)+1);if(e.reference)refs.set(e.reference,(refs.get(e.reference)||0)+1);if(e.userId)users.set(e.userId,(users.get(e.userId)||0)+1);}
  for(const e of entries){if(e.phone&&numbers.get(e.phone)>1)e.issues.push('Number appears more than once in this list');if(e.reference&&refs.get(e.reference)>1)e.issues.push('Duplicate reference');if(e.userId&&users.get(e.userId)>1)e.issues.push('Duplicate Matrix user ID');}
  return entries;
}
export function report(state,now=Date.now()) {
  const approvedVersion=digest(state.approved.map(a=>[a.phone,a.reference,a.name,a.issues]));
  const counts={};
  for(const p of state.participants)if(p.membership==='join'&&p.phone)counts[p.phone]=(counts[p.phone]||0)+1;
  return state.participants.map(p=>{
    const matches=p.phone?state.approved.filter(a=>a.phone===p.phone):[];
    const signature=digest([state.settings.roomId,p.userId,p.phoneRaw,p.phone,p.membership,approvedVersion]);
    let status,reason;
    if(p.membership!=='join'){status='left';reason='Observed leave or ban event; not in the current comparison';}
    else if(p.userId&&(state.settings.exemptUserIds||[]).includes(p.userId)){status='service-account';reason='Explicit organiser exclusion for a bot or service account';}
    else if(!p.phone){status=p.phoneRaw?'invalid-number':'missing-number';reason=p.phoneError||'Bridge did not expose a phone number; organiser verification needed';}
    else if(counts[p.phone]>1){status='ambiguous';reason='Multiple participant entries use this number';}
    else if(matches.length>1||matches.some(a=>a.issues.length)){status='ambiguous';reason='Approved list has duplicate or conflicting entries for this number';}
    else if(matches.length===1){status='on-list';reason='Exact normalised-number match to the supplied list';}
    else{status='needs-review';reason='No matching number in the supplied list';}
    const decision=state.decisions[p.id];
    const current=decision&&decision.signature===signature&&(!decision.expiresAt||Date.parse(decision.expiresAt)>now);
    if(current&&p.membership==='join'&&status!=='service-account'){
      if(decision.outcome==='guest-exception'){status='exception';reason='Organiser recorded a guest exception';}
      else if(decision.outcome==='changed-number'){status='changed-number';reason='Organiser linked this participant to an approved-list reference';}
      else if(decision.outcome==='not-approved'){status='not-approved';reason='Organiser marked this participant as not approved; no removal performed';}
      else{status='awaiting-check';reason='Organiser is checking the missing or ambiguous details';}
    }
    return {...p,status,reason,signature,approvedMatches:matches.map(a=>({name:a.name,reference:a.reference,phone:a.phone})),decision:current?decision:null,previousDecision:decision&&!current?decision:null};
  });
}
export function participantFromEvent(event,settings,existing=[]) {
  if(event?.type!=='m.room.member'||!['join','leave','ban'].includes(event.content?.membership))return null;
  if(event.room_id!==settings.roomId)return null;
  if(typeof event.event_id!=='string'||!event.event_id||event.event_id.length>500||typeof event.state_key!=='string'||!/^@[^\s:]+:[^\s]+$/.test(event.state_key)||event.state_key.length>300)throw Error('Membership events require event_id and a valid state_key');
  const prior=existing.find(p=>p.userId===event.state_key);
  return {id:prior?.id||digest(['matrix',event.room_id,event.state_key]).slice(0,20),name:String(event.content.displayname||prior?.name||'').slice(0,300),userId:event.state_key,phoneRaw:prior?.phoneRaw||'',phone:prior?.phone||null,phoneError:prior?.phoneError||'No verified number mapping for this Matrix identity',reference:'',issues:[],source:prior?.source==='csv'?'csv + observed event':'observed event',membership:event.content.membership,eventId:event.event_id,eventTs:Number.isFinite(event.origin_server_ts)?event.origin_server_ts:0};
}
