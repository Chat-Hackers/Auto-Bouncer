const $=id=>document.getElementById(id);
const node=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
const button=(text,onclick,className='secondary')=>{const b=node('button',text,className);b.type='button';b.onclick=onclick;return b;};
let token='',snapshot=null,filter='attention';
try{token=sessionStorage.getItem('bouncer-token')||'';}catch{}
const notice=text=>$('notice').textContent=text;
async function api(route,data){const res=await fetch('./api/'+route,{method:data===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});const value=await res.json();if(!res.ok)throw Error(value.error||'Request failed');return value;}
const run=fn=>async(...args)=>{try{await fn(...args);}catch(e){notice(e.message);}};
const download=(data,name)=>{const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);};

// People
const statusText={'on-list':['Approved','ok'],'exception':['Allowed','ok'],'changed-number':['Allowed','ok'],'needs-review':['Not on list','bad'],'not-approved':['Not approved','bad'],'missing-number':['Number hidden','warn'],'invalid-number':['Bad number','warn'],'ambiguous':['Duplicate number','warn'],'awaiting-check':['Checking','warn'],'service-account':['Ignored','muted'],'left':['Left','muted']};
const attention=r=>r.membership==='join'&&['needs-review','not-approved','missing-number','invalid-number','ambiguous','awaiting-check'].includes(r.status);
const filters={attention:['Needs action',attention],approved:['Approved',r=>['on-list','exception','changed-number'].includes(r.status)],all:['In group',r=>r.membership==='join'],left:['Left',r=>r.membership!=='join']};
function renderPeople(){
 const rows=snapshot.rows;
 $('filters').replaceChildren(...Object.entries(filters).map(([key,[label,test]])=>{const b=button(`${label} ${rows.filter(test).length}`,()=>{filter=key;renderPeople();},key===filter?'chip active':'chip');return b;}));
 const shown=rows.filter(filters[filter][1]).sort((a,b)=>(b.eventTs||0)-(a.eventTs||0));
 $('empty').hidden=Boolean(shown.length);
 $('rows').replaceChildren(...shown.map(r=>{
  const tr=node('tr'),who=node('td'),number=node('td',r.phone||r.phoneRaw||'—'),status=node('td'),actions=node('td',undefined,'actions');
  who.append(node('strong',r.name||r.userId||'Unknown'),node('small',r.name?r.userId:''));
  const left=r.membership!=='join',[label,tone]=left&&r.kick?.status==='sent'?['Removed','muted']:statusText[r.status]||[r.status,'muted'];
  status.append(node('span',label,'tag '+tone));
  if(r.kick&&!left)status.append(node('small',r.kick.status==='failed'?'Removal failed: '+r.kick.error:'Removal sent',r.kick.status==='failed'?'error':''));
  if(!left&&r.status!=='service-account'){
   if(['exception','changed-number'].includes(r.status))actions.append(button('Undo allow',run(()=>review(r,'clear','Allowance removed by organiser'))));
   else if(r.status!=='on-list')actions.append(button('Allow',run(()=>review(r,'guest-exception','Allowed by organiser'))));
   if(r.userId&&!snapshot.isDemo)actions.append(button('Remove',run(()=>kick(r)),'danger'));
  }
  tr.append(who,number,status,actions);return tr;
 }));
}
async function review(r,outcome,note){await api(`participants/${r.id}/review`,{signature:r.signature,outcome,note});await refresh();notice(outcome==='clear'?'Allowance removed.':`${r.name||r.userId} allowed.`);}
async function kick(r){if(!confirm(`Remove ${r.name||r.userId} from the group?`))return false;await api(`participants/${r.id}/kick`,{});await refresh();notice(`Removal sent for ${r.name||r.userId}.`);return true;}

// Flagged messages
function renderFlags(){
 const all=snapshot.moderation?.incidents||[],showReviewed=$('show-reviewed').checked;
 const shown=all.filter(i=>showReviewed||i.status==='pending');
 if(!shown.length){$('flags').replaceChildren(node('p',all.length?'Nothing waiting. Tick "Show reviewed" to see past flags.':'No flagged messages yet.','empty'));return;}
 const labels={pending:'New','false-positive':'Fine',confirmed:'Concern',dismissed:'Dismissed'};
 $('flags').replaceChildren(...shown.map(i=>{
  const item=node('article',undefined,'flag'),person=snapshot.rows.find(r=>r.userId===i.sender);
  const meta=node('div',undefined,'meta');meta.append(node('strong',i.displayName||i.sender),node('small',new Date(i.receivedAt).toLocaleString('en-GB',{timeZone:'Europe/London',dateStyle:'short',timeStyle:'short'})),node('span',labels[i.status]||i.status,'tag '+(i.status==='pending'?'warn':'muted')));
  const why=[`Matched: ${i.matches.map(m=>m.phrase).join(', ')}`];if(i.warning==='returned-to-hub')why.push('warning sent');if(i.removal)why.push('removal sent');
  const actions=node('div',undefined,'actions');
  actions.append(button('Fine',run(()=>decide(i,'false-positive'))),button('Concern',run(()=>decide(i,'confirmed'))));
  if(person&&person.membership==='join'&&!snapshot.isDemo)actions.append(button('Remove sender',run(async()=>{if(await kick(person))await decide(i,'confirmed');}),'danger'));
  item.append(meta,node('p',i.text,'message'),node('small',why.join(' · ')),actions);return item;
 }));
}
async function decide(i,status){await api(`moderation/incidents/${i.id}/review`,{status,note:status==='false-positive'?'Marked fine by organiser':'Marked as a concern by organiser'});await refresh();}

// Settings and rules
function ruleRow(rule={id:crypto.randomUUID(),phrase:'',action:'review',enabled:true,exceptions:[]}){
 const row=node('div',undefined,'rule');row.dataset.id=rule.id;
 const on=document.createElement('input');on.type='checkbox';on.checked=rule.enabled;on.dataset.field='enabled';on.title='Rule on';on.setAttribute('aria-label','Rule on');
 const phrase=document.createElement('input');phrase.value=rule.phrase;phrase.maxLength=200;phrase.placeholder='word or phrase';phrase.dataset.field='phrase';phrase.setAttribute('aria-label','Word or phrase');
 const action=document.createElement('select');action.dataset.field='action';action.setAttribute('aria-label','Action');
 for(const [value,text] of [['review','Flag'],['warn','Flag + warn'],['remove','Flag + remove']]){const o=node('option',text);o.value=value;action.append(o);}action.value=rule.action;
 const except=document.createElement('input');except.value=rule.exceptions.join('; ');except.placeholder='except…';except.dataset.field='exceptions';except.setAttribute('aria-label','Exceptions');
 row.append(on,phrase,action,except,button('×',()=>row.remove(),'link'));return row;
}
function fillForms(){
 const s=snapshot.settings,c=snapshot.moderation.config;
 $('room').value=s.roomId;$('country').value=s.country;$('auto-kick').value=s.autoKick||'off';$('exempt').value=s.exemptUserIds.join('\n');
 $('mod-mode').value=c.mode;$('mod-warning').value=c.warning;$('mod-rules').replaceChildren(...c.rules.map(ruleRow));
 const i=snapshot.imports.approved;$('approved-summary').textContent=i?`${i.rows} numbers saved${i.issues?`, ${i.issues} with problems`:''}.`:'No list saved yet.';
 if(!s.roomId)$('settings-card').open=true;
}
function renderPills(){
 const live=snapshot.moderation.config.mode==='live'&&!snapshot.isDemo,auto=snapshot.settings.autoKick||'off';
 $('pills').replaceChildren(...[snapshot.isDemo&&['Demo data','warn'],[auto==='off'?'Auto-remove off':'Auto-remove on',auto==='off'?'muted':'bad'],[live?'Rules live':'Rules: flag only',live?'bad':'muted']].filter(Boolean).map(([t,tone])=>node('span',t,'tag '+tone)));
 $('demo').hidden=Boolean(snapshot.isDemo||snapshot.approved.length||snapshot.participants.length);$('clear-demo').hidden=!snapshot.isDemo;
}
async function refresh(forms=false){snapshot=await api('state');$('login').hidden=true;$('app').hidden=false;renderPills();renderPeople();renderFlags();if(forms)fillForms();}

$('login').onsubmit=run(async e=>{e.preventDefault();token=$('token').value.trim();await refresh(true);try{sessionStorage.setItem('bouncer-token',token);}catch{}notice('');});
$('logout').onclick=()=>{try{sessionStorage.removeItem('bouncer-token');}catch{}location.reload();};
$('settings').onsubmit=run(async e=>{e.preventDefault();await api('settings',{roomId:$('room').value.trim(),country:$('country').value,autoKick:$('auto-kick').value,exemptUserIds:$('exempt').value.split('\n').map(s=>s.trim()).filter(Boolean)});await refresh(true);notice('Settings saved.');});
$('approved-file').onchange=run(async()=>{const file=$('approved-file').files[0];if(!file)return;if(file.size>1000000)throw Error('Choose a CSV under 1 MB');$('approved-csv').value=await file.text();});
$('approved-save').onclick=run(async()=>{
 const csv=$('approved-csv').value;const preview=await api('import/preview',{kind:'approved',csv});
 if(snapshot.approved.length&&!confirm(`Replace the current list of ${snapshot.approved.length} with these ${preview.entries.length} numbers?`))return;
 await api('import/apply',{kind:'approved',csv,expectedVersion:preview.version});$('approved-csv').value='';await refresh(true);
 const problems=preview.entries.filter(e=>e.issues.length);
 $('approved-summary').textContent=`${preview.entries.length} numbers saved.`+(problems.length?` Problems: `+problems.slice(0,5).map(e=>`row ${e.row} (${e.issues[0]})`).join('; ')+(problems.length>5?'…':''):'');
 notice('Approved list saved.');
});
$('mod-add').onclick=()=>$('mod-rules').append(ruleRow());
$('mod-save').onclick=run(async()=>{
 const c=snapshot.moderation.config;
 const rules=[...$('mod-rules').children].map(row=>({id:row.dataset.id,enabled:row.querySelector('[data-field=enabled]').checked,phrase:row.querySelector('[data-field=phrase]').value,action:row.querySelector('[data-field=action]').value,exceptions:row.querySelector('[data-field=exceptions]').value.split(';').map(s=>s.trim()).filter(Boolean)})).filter(r=>r.phrase.trim());
 await api('moderation/config',{...c,rooms:[],mode:$('mod-mode').value,warning:$('mod-warning').value,rules});await refresh(true);notice('Rules saved.');
});
$('show-reviewed').onchange=()=>snapshot&&renderFlags();
$('registration').onclick=run(async()=>{download(await api('registration'),'whatsapp-bouncer.json');notice('Hub JSON downloaded. It contains the webhook secret, so share it privately.');});
$('export').onclick=run(async()=>{download(await api('report'),'bouncer-report.json');notice('Report downloaded. It contains full phone numbers.');});
$('demo').onclick=run(async()=>{await api('demo',{});await refresh(true);notice('Demo loaded. Nothing here is real.');});
$('clear-demo').onclick=run(async()=>{await api('demo/reset',{});await refresh(true);notice('Demo cleared.');});
if(token){$('token').value=token;refresh(true).catch(e=>notice(e.message));}
setInterval(()=>{if(snapshot&&!document.hidden)refresh().catch(e=>notice(e.message));},10000);
