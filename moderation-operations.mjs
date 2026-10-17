import { defaults, evaluate, validateConfig } from './moderation.mjs';
import { digest } from './bouncer.mjs';

export const initialModeration = () => ({config:defaults(),incidents:[],seen:{},lastWarnings:{}});
export function ensureModeration(state) { state.moderation ||= initialModeration(); return state.moderation; }
export function publicModeration(state) {
 const m=ensureModeration(state);
 return {config:{...m.config,rooms:state.settings.roomId?[state.settings.roomId]:[]},incidents:m.incidents,
  capabilities:{warning:'Hub event response; delivery unconfirmed',removal:'Not enabled: working kick contract still required',deletion:'Not enabled'}};
}
export function moderateEvent(state,payload) {
 const m=ensureModeration(state),{event,botUserId}=payload;
 if(!state.settings.roomId || event?.room_id!==state.settings.roomId)return {changed:false,data:{success:true,response:{},reason:'Room is not enabled'}};
 const config={...m.config,exemptSenders:[...new Set([...m.config.exemptSenders,...state.settings.exemptUserIds]) ]};
 const result=evaluate(event,config,botUserId);
 if(result.ignored)return {changed:false,data:{success:true,response:{},reason:result.ignored}};
 const key=digest([event.room_id,event.event_id]);
 if(m.seen[key])return {changed:false,data:{success:true,response:{},reason:'Duplicate event'}};
 const now=Date.now();m.seen[key]=now;
 for(const [key,at] of Object.entries(m.seen))if(now-at>7*86400000)delete m.seen[key];
 if(!result.matches.length)return {changed:true,data:{success:true,response:{},reason:result.exceptions.length?'Allowed by rule exception':'No rule matched'}};
 const cooldownKey=digest([event.room_id,event.sender]);
 const wantsWarning=result.matches.some(match=>match.action==='warn');
 const inCooldown=now-(m.lastWarnings[cooldownKey]||0)<config.cooldownSeconds*1000;
 const reply=!state.isDemo&&config.mode==='live'&&wantsWarning&&!inCooldown;
 const incident={id:key.slice(0,32),eventId:event.event_id,roomId:event.room_id,sender:event.sender,
  displayName:String(payload.displayName||event.sender).slice(0,300),text:result.text,matches:result.matches,exceptions:result.exceptions,
  receivedAt:new Date(now).toISOString(),status:'pending',note:'',mode:state.isDemo?'demo':config.mode,
  warning:reply?'returned-to-hub':state.isDemo||config.mode==='demo'?'demo-only':wantsWarning&&inCooldown?'cooldown':'review-only'};
 m.incidents.unshift(incident);
 if(reply)m.lastWarnings[cooldownKey]=now;
 return {changed:true,data:{success:true,response:reply?{message:config.warning,context:{autoModerator:true,moduleEvent:true}}:{},incidentId:incident.id}};
}

export function moderationRoute(state,{method,pathname,input}) {
 if(!pathname.startsWith('/api/moderation/'))return null;
 const m=ensureModeration(state);
 if(method==='POST'&&pathname==='/api/moderation/config') {
  if(state.isDemo&&input.mode==='live')throw Error('Clear the labelled demo before enabling live warnings');
  // Scope always comes from the existing group settings, not a browser-supplied room list.
  const config=validateConfig({...input,rooms:state.settings.roomId?[state.settings.roomId]:[]});
  m.config=config;
  state.audit.push({at:new Date().toISOString(),action:'moderation-config-updated',config:structuredClone(config)});
  return {code:200,data:{success:true},changed:true};
 }
 if(method==='POST'&&pathname==='/api/moderation/simulate') {
  const config=input.config?validateConfig({...input.config,rooms:state.settings.roomId?[state.settings.roomId]:[]}):m.config;
  const result=evaluate({event_id:'$simulation',room_id:'!simulator:local',sender:input.sender||'@test:local',type:'m.room.message',content:{msgtype:'m.text',body:input.text}},
   {...config,exemptSenders:[...new Set([...config.exemptSenders,...state.settings.exemptUserIds])]});
  return {code:200,data:{...result,simulation:true,proposedWarning:result.matches.some(match=>match.action==='warn')?config.warning:null},changed:false};
 }
 const review=pathname.match(/^\/api\/moderation\/incidents\/([^/]+)\/review$/);
 if(method==='POST'&&review) {
  if(!['confirmed','false-positive','dismissed'].includes(input.status))throw Error('Choose a supported moderation decision');
  if(typeof input.note!=='string'||!input.note.trim()||input.note.length>2000)throw Error('Add a review note of 1–2,000 characters');
  const incident=m.incidents.find(i=>i.id===review[1]);
  if(!incident)return {code:404,data:{error:'Moderation incident not found'},changed:false};
  Object.assign(incident,{status:input.status,note:input.note.trim(),reviewedAt:new Date().toISOString()});
  state.audit.push({at:incident.reviewedAt,action:'moderation-review',incidentId:incident.id,status:incident.status,note:incident.note});
  return {code:200,data:{success:true},changed:true};
 }
 return {code:404,data:{error:'Unknown moderation endpoint'},changed:false};
}

export function loadModerationDemo(state) {
 const m=ensureModeration(state);m.config.mode='demo';
 for(const [id,text] of [['direct','You are an idiot.'],['context','Please don’t call people an idiot.'],['review','Shut up.']]) {
  moderateEvent(state,{displayName:'LOCAL DEMO — not a real participant',botUserId:'@bot:local',event:{event_id:'$moderation-demo-'+id,room_id:state.settings.roomId,sender:'@demo_unknown:local',type:'m.room.message',content:{msgtype:'m.text',body:text}}});
 }
 const context=m.incidents.find(i=>i.eventId==='$moderation-demo-context');
 context.status='false-positive';context.note='Demo: the speaker challenges an insult. Keyword matching misses the context.';context.reviewedAt=new Date().toISOString();
}
