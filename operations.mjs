import { timingSafeEqual } from 'node:crypto';
import { digest,prepareImport,report,participantFromEvent,phoneFromUserId,isBridgedUser } from './bouncer.mjs';
import { bridgeParticipant,applyMemberSnapshot } from './hub-members.mjs';
import { initialModeration,ensureModeration,publicModeration,moderateEvent,moderationRoute,loadModerationDemo } from './moderation-operations.mjs';
export const autoKickModes=['off','unlisted','strict'];
export const initialState=()=>({settings:{roomId:'',country:'GB',exemptUserIds:[],autoKick:'off'},approved:[],participants:[],decisions:{},seen:{},audit:[],imports:{},moderation:initialModeration()});
export const secureEqual=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y);};
export async function operate(original,{method,url,headers,input},identity){
 let state=structuredClone(original),changed=false;const kicks=[];
 ensureModeration(state);
 const save=()=>{changed=true;};
 const req={method,headers},res=null,body=async()=>input;
 const json=(_res,code,data)=>({code,data});
 const publicState=()=>({...state,seen:undefined,moderation:publicModeration(state),rows:report(state),generatedAt:new Date().toISOString()});

 const result=await (async()=>{
  if(req.method==='POST'&&url.pathname==='/'){
    if(!secureEqual(url.searchParams.get('hook'),identity.secret))return json(res,401,{error:'Invalid webhook secret'});
    const payload=await body(req);const {event,participant}=payload;
    if(event?.type==='m.room.message') {
      if(rememberSender(state,event,payload.botUserId))save();
      const result=moderateEvent(state,payload);if(result.changed)save();
      for(const kick of result.kicks||[])requestKick(state,kicks,kick.userId,kick.reason,'message rule');
      return json(res,200,result.data);
    }
    const p=participantFromEvent(event,state.settings,state.participants);
    if(!p)return json(res,200,{success:true,response:{},reason:'Not a relevant membership event'});
    if(participant!==undefined){const mapped=bridgeParticipant(participant,state.settings.country,p.userId);Object.assign(p,{phoneRaw:mapped.phoneRaw,phone:mapped.phone,phoneError:mapped.phoneError,phoneSource:mapped.phoneSource,source:'Hub membership event'});}
    const key=digest([event.room_id,event.event_id]);
    if(state.seen[key])return json(res,200,{success:true,response:{},reason:'Duplicate event'});
    const prior=state.participants.find(x=>x.userId===p.userId);
    if(prior?.eventTs&&p.eventTs&&p.eventTs<prior.eventTs)return json(res,200,{success:true,response:{},reason:'Older than last observed membership event'});
    if(!prior&&state.participants.length>=5000)throw Error('Participant limit reached; ask organiser to archive a snapshot');
    state.seen[key]=Date.now();
    if(prior)Object.assign(prior,p);else state.participants.push(p);
    for(const [id,at] of Object.entries(state.seen))if(Date.now()-at>7*86400000)delete state.seen[id];
    state.lastObservedAt=new Date().toISOString();save();
    if(p.membership==='join'&&shouldAutoKick(state,p.userId,payload.botUserId)){requestKick(state,kicks,p.userId,'Not on the approved list for this group','auto-remove');return json(res,200,{success:true,response:{},reason:'Not on the approved list; removal requested'});}
    return json(res,200,{success:true,response:{},reason:'Membership observation recorded'});
  }
  if(url.pathname.startsWith('/api/')){
    if(!secureEqual(req.headers.authorization,`Bearer ${identity.adminToken}`))return json(res,401,{error:'Enter the organiser access token printed in the terminal'});
    if(req.method==='GET'&&url.pathname==='/api/state')return json(res,200,publicState());
    if(req.method==='GET'&&url.pathname==='/api/report')return json(res,200,{...publicState(),approved:undefined,participants:undefined,decisions:undefined});
    const moderation=moderationRoute(state,{method:req.method,pathname:url.pathname,input});
    if(moderation){if(moderation.changed)save();return json(res,moderation.code,moderation.data);}
    if(req.method==='POST'&&url.pathname==='/api/participants/sync'){
      const sync=applyMemberSnapshot(state,input);save();return json(res,200,{success:true,...sync});
    }
    if(req.method==='POST'&&url.pathname==='/api/settings'){
      const input=await body(req);
      if(typeof input.roomId!=='string'||input.roomId.length>300||input.roomId&&!input.roomId.startsWith('!'))throw Error('Enter a Matrix room ID starting with !');
      if(!['GB','international'].includes(input.country))throw Error('Choose UK or international-only phone formats');
      const autoKick=input.autoKick??state.settings.autoKick??'off';
      if(!autoKickModes.includes(autoKick))throw Error('Choose an auto-remove option');
      if(state.isDemo&&autoKick!=='off')throw Error('Clear the demo before turning on auto-remove');
      if(!Array.isArray(input.exemptUserIds)||input.exemptUserIds.length>100||input.exemptUserIds.some(s=>typeof s!=='string'||!/^@[^\s:]+:[^\s]+$/.test(s)||s.length>300))throw Error('Use valid Matrix IDs for service-account exclusions');
      if((state.participants.length||state.moderation.incidents.length)&&input.roomId!==state.settings.roomId)throw Error('This instance already holds group data. Use a separate instance/data directory for another group.');
      if(state.approved.length&&input.country!==state.settings.country)throw Error('Phone format is fixed once lists are imported; use a new instance to change it.');
      state.settings={roomId:input.roomId.trim(),country:input.country,exemptUserIds:input.exemptUserIds,autoKick};state.audit.push({at:new Date().toISOString(),action:'settings-updated',settings:state.settings});save();return json(res,200,{success:true});
    }
    if(req.method==='POST'&&['/api/import/preview','/api/import/apply'].includes(url.pathname)){
      if(state.isDemo)throw Error('Clear the labelled demo before importing real lists');
      const {kind,csv,expectedVersion}=await body(req);const entries=prepareImport(kind,csv,state.settings.country);
      const version=digest(state[kind]||[]);
      if(url.pathname.endsWith('preview'))return json(res,200,{entries,version,kind,issues:entries.filter(e=>e.issues.length).length});
      if(!state.settings.roomId)throw Error('Set the group room ID before importing');
      if(expectedVersion!==version)throw Error('The list changed; preview again before applying');
      if(!entries.length)throw Error('The list is empty; nothing imported');
      if(kind==='participants'&&entries.some(e=>e.userId&&e.issues.includes('Invalid Matrix user ID')))throw Error('Fix invalid Matrix IDs before applying the participant list');
      if(kind==='participants'&&entries.some(e=>e.issues.includes('Duplicate Matrix user ID')))throw Error('Duplicate Matrix IDs cannot identify participants reliably; resolve them first');
      state[kind]=entries;
      state.imports[kind]={at:new Date().toISOString(),rows:entries.length,issues:entries.filter(e=>e.issues.length).length};
      state.audit.push({at:new Date().toISOString(),action:'list-imported',kind,rows:entries.length});save();return json(res,200,{success:true});
    }
    const kick=url.pathname.match(/^\/api\/participants\/([^/]+)\/kick$/);
    if(req.method==='POST'&&kick){
      const row=report(state).find(p=>p.id===kick[1]);if(!row)return json(res,404,{error:'Participant not found'});
      if(state.isDemo)throw Error('Demo participants are not real; nothing to remove');
      if(row.membership!=='join')throw Error('This person has already left');
      if(!row.userId)throw Error('This entry has no group identity to remove');
      requestKick(state,kicks,row.userId,'Removed by an organiser','organiser');save();return json(res,200,{success:true});
    }
    const review=url.pathname.match(/^\/api\/participants\/([^/]+)\/review$/);
    if(req.method==='POST'&&review){
      const input=await body(req);const row=report(state).find(p=>p.id===review[1]);if(!row)return json(res,404,{error:'Participant not found'});
      if(input.signature!==row.signature)throw Error('Participant or approved list changed; refresh before deciding');
      if(row.membership!=='join')throw Error('This participant has left; no current access decision is needed');
      if(!['guest-exception','changed-number','awaiting-check','not-approved','clear'].includes(input.outcome))throw Error('Choose a supported review outcome');
      if(typeof input.note!=='string'||!input.note.trim()||input.note.length>2000)throw Error('Add a note of 1–2,000 characters');
      if(input.expiresAt&&(!Number.isFinite(Date.parse(input.expiresAt))||Date.parse(input.expiresAt)<=Date.now()))throw Error('Expiry must be in the future');
      if(input.outcome==='changed-number'){
        const matches=state.approved.filter(a=>a.reference&&a.reference===input.linkedReference&&!a.issues.length);
        if(matches.length!==1)throw Error('Select a unique, valid approved-list reference for the changed number');
      }
      const decision={outcome:input.outcome,note:input.note.trim(),signature:row.signature,linkedReference:input.outcome==='changed-number'?input.linkedReference:'',expiresAt:input.expiresAt||null,at:new Date().toISOString()};
      if(input.outcome==='clear')delete state.decisions[row.id];else state.decisions[row.id]=decision;
      state.audit.push({action:'review',participantId:row.id,...decision});save();return json(res,200,{success:true});
    }
    if(req.method==='POST'&&url.pathname==='/api/demo'){
      await body(req);if(state.approved.length||state.participants.length)throw Error('Demo data can only be loaded into an empty instance');
      state.settings={roomId:'!bouncer-demo:local',country:'GB',exemptUserIds:[]};
      state.isDemo=true;
      state.approved=prepareImport('approved','phone,name,reference\n07700 900101,Example A,DEMO-A\n+44 7700 900102,Example B,DEMO-B\n00447700900103,Example C,DEMO-C\n07700 900104,Example D,DEMO-D\n+44 7700 900104,Duplicate D,DEMO-DUP',state.settings.country);
      state.participants=prepareImport('participants','phone,name,matrix_user_id\n+44 (0)7700 900101,Example A,@demo_a:local\n07700 900199,Unmatched example,@demo_unknown:local\n,Opaque identity example,@opaque_lid:local\n07700 900104,Duplicate-list example,@demo_dup:local\n07700 900202,Changed-number example,@demo_changed:local\n+44 7700 900103,Example C,@demo_c:local',state.settings.country);
      const changed=report(state).find(p=>p.userId==='@demo_changed:local');state.decisions[changed.id]={outcome:'changed-number',note:'Demo organiser checked the new number against reference DEMO-B. Original approved list preserved.',linkedReference:'DEMO-B',signature:changed.signature,at:new Date().toISOString(),expiresAt:null};
      state.imports={approved:{at:new Date().toISOString(),rows:state.approved.length},participants:{at:new Date().toISOString(),rows:state.participants.length}};
      loadModerationDemo(state);
      state.audit.push({at:new Date().toISOString(),action:'demo-loaded',note:'Illustrative entries only; no real group connected'});save();return json(res,200,{success:true});
    }
    if(req.method==='POST'&&url.pathname==='/api/demo/reset'){
      await body(req);if(!state.isDemo)throw Error('Only the labelled demo can be cleared here');
      state={...initialState(),audit:[{at:new Date().toISOString(),action:'demo-cleared'}]};
      save();return json(res,200,{success:true});
    }
    return json(res,404,{error:'Unknown endpoint'});
  }

 return json(res,404,{error:'Unknown endpoint'});
 })();
 return {...result,state,changed,kicks};
}
// Only bridged WhatsApp members are ever removed automatically: organisers' own Matrix
// accounts, bots and anyone explicitly exempted or allowed are left alone.
function shouldAutoKick(state,userId,botUserId){
 const mode=state.settings.autoKick||'off';
 if(mode==='off'||state.isDemo||!isBridgedUser(userId)||userId===botUserId)return false;
 const row=report(state).find(r=>r.userId===userId&&r.membership==='join');
 if(!row)return false;
 if(['needs-review','not-approved'].includes(row.status))return true;
 return mode==='strict'&&['missing-number','invalid-number'].includes(row.status);
}
function requestKick(state,kicks,userId,reason,by){
 if(kicks.some(k=>k.userId===userId))return;
 const participant=state.participants.find(p=>p.userId===userId);
 const at=new Date().toISOString();
 if(participant)participant.kick={status:'requested',at,by};
 state.audit.push({at,action:'removal-requested',userId,by});
 kicks.push({userId,reason});
}
// Messages from people who joined before the tool was active add them to the list.
function rememberSender(state,event,botUserId){
 const userId=event.sender;
 if(event.room_id!==state.settings.roomId||userId===botUserId||!/^@[^\s:]+:[^\s]+$/.test(userId||'')||userId.length>300)return false;
 if(state.participants.some(p=>p.userId===userId)||state.participants.length>=5000)return false;
 const phone=phoneFromUserId(userId,state.settings.country)||{phoneRaw:'',phone:null,phoneError:'WhatsApp is hiding this number',phoneSource:'unavailable'};
 state.participants.push({id:digest(['matrix',event.room_id,userId]).slice(0,20),name:'',userId,...phone,reference:'',issues:[],source:'seen in chat',membership:'join',eventTs:0});
 return true;
}
export function recordKicks(state,outcomes){
 for(const {userId,ok,error} of outcomes){
  const participant=state.participants.find(p=>p.userId===userId);
  const at=new Date().toISOString();
  if(participant)participant.kick={...participant.kick,status:ok?'sent':'failed',error:ok?null:error,at};
  state.audit.push({at,action:ok?'removal-sent':'removal-failed',userId,note:error||undefined});
 }
 return {code:200,data:{},state,changed:true};
}
