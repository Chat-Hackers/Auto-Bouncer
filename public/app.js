import { initModeration,renderModeration } from './moderator-ui.js';
const $=id=>document.getElementById(id);
const node=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
let token=sessionStorage.getItem('bouncer-token')||'',snapshot=null,selected=null,previews={};
$('token').value=token;
const notice=text=>$('notice').textContent=text;
async function api(route,data){const res=await fetch('./api/'+route,{method:data===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});const value=await res.json();if(!res.ok)throw Error(value.error||'Request failed');return value;}
const labels={'on-list':'On supplied list','needs-review':'Needs checking','missing-number':'Number unavailable','invalid-number':'Invalid number','ambiguous':'Ambiguous entries','exception':'Guest exception','changed-number':'Changed number verified','not-approved':'Not approved (reviewed)','awaiting-check':'Verification pending','left':'Observed leave / ban','service-account':'Service account'};
const reviewStatuses=['needs-review','missing-number','invalid-number','ambiguous','awaiting-check','not-approved'];
const mask=number=>number?number.slice(0,3)+' •••• '+number.slice(-4):'Not available';
function render(){
 $('clear-demo').disabled=!snapshot.isDemo;
 $('demo').disabled=Boolean(snapshot.approved.length||snapshot.participants.length);
 const rows=snapshot.rows;
 const stats=[['Current participants',rows.filter(r=>r.membership==='join').length],['On approved list',rows.filter(r=>r.status==='on-list').length],['Need organiser review',rows.filter(r=>reviewStatuses.includes(r.status)).length],['Recorded exceptions',rows.filter(r=>['exception','changed-number'].includes(r.status)).length]];
 $('stats').replaceChildren(...stats.map(([title,value])=>{const div=node('div',undefined,'stat');div.append(node('strong',String(value)),node('small',title));return div;}));
 const imports=snapshot.imports;
 $('sync-status').textContent=snapshot.rosterSync?`Last sync: ${snapshot.rosterSync.count} members; ${snapshot.rosterSync.missingNumbers} without a bridge number. Review unresolved entries below.`:'Requires the Hub members API. Missing numbers stay available for review.';
 $('freshness').textContent=`Room: ${snapshot.settings.roomId||'not configured'} · Approved list: ${imports.approved?new Date(imports.approved.at).toLocaleString('en-GB',{timeZone:'Europe/London'})+' London time':'not loaded'} · Group sync: ${snapshot.rosterSync?new Date(snapshot.rosterSync.at).toLocaleString('en-GB',{timeZone:'Europe/London'})+' London time':'not synced'}. Membership events update observed identities.`;
 let shown=rows;
 const filter=$('filter').value;
 if(filter==='review')shown=rows.filter(r=>reviewStatuses.includes(r.status));
 else if(filter==='exceptions')shown=rows.filter(r=>['exception','changed-number'].includes(r.status));
 else if(filter!=='all')shown=rows.filter(r=>r.status===filter);
 $('rows').replaceChildren();$('empty').hidden=Boolean(shown.length);
 for(const r of shown){
  const tr=node('tr'),identity=node('td'),number=node('td'),comparison=node('td'),review=node('td');
  identity.append(node('strong',r.name||'Unnamed participant'),node('small',r.userId||'No Matrix identity supplied'),node('small',r.source));
  number.append(node('span',$('show-numbers').checked?(r.phone||r.phoneRaw||'Not available'):mask(r.phone)));
  comparison.append(node('span',labels[r.status]||r.status,`status ${r.status}`),node('p',r.reason));
  if(r.approvedMatches.length)comparison.append(node('small',r.approvedMatches.map(a=>a.reference||a.name||'Approved entry').join(', ')));
  if(r.decision)review.append(node('p',r.decision.note),node('small',r.decision.linkedReference?'Linked reference: '+r.decision.linkedReference:'Organiser decision recorded'));
  else if(r.previousDecision)review.append(node('p','Previous decision expired or became stale. Review again.'));
  if(r.membership==='join'&&r.status!=='service-account'){const button=node('button',r.decision?'Update decision':'Review entry','secondary review-button');button.onclick=()=>openReview(r);review.append(button);}else review.append(node('small','No current review action'));
  tr.append(identity,number,comparison,review);$('rows').append(tr);
 }
 $('audit').replaceChildren(...snapshot.audit.slice(-20).reverse().map(a=>node('div',`${new Date(a.at).toLocaleString('en-GB',{timeZone:'Europe/London'})} · ${a.action}${a.kind?' · '+a.kind:''}${a.outcome?' · '+a.outcome:''}${a.note?' · '+a.note:''}`,'audit-item')));
}
async function refresh(settings=false){snapshot=await api('state');if(settings){$('room').value=snapshot.settings.roomId;$('country').value=snapshot.settings.country;$('exempt').value=snapshot.settings.exemptUserIds.join('\n');}render();renderModeration(snapshot,settings);}
$('connect').onclick=async()=>{token=$('token').value.trim();try{await refresh(true);sessionStorage.setItem('bouncer-token',token);notice('Connected. Load the demo or configure one group and preview your lists.');}catch(e){notice(e.message);}};
$('registration').onclick=async()=>{try{const data=await api('registration');const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='whatsapp-bouncer.json';link.click();URL.revokeObjectURL(url);notice('Registration JSON downloaded. Send it privately to your Hub operator; it contains the webhook secret.');}catch(e){notice(e.message);}};
$('demo').onclick=async()=>{try{await api('demo',{});await refresh(true);notice('Demo loaded: two exact matches, an unmatched number, an opaque identity, a duplicate and a verified changed number. No real group connected.');}catch(e){notice(e.message);}};
$('clear-demo').onclick=async()=>{try{await api('demo/reset',{});previews={};for(const kind of ['approved','participants'])$(kind+'-result').replaceChildren();await refresh(true);notice('Labelled demo cleared. Configure your real group before importing its lists.');}catch(e){notice(e.message);}};
$('save-settings').onclick=async()=>{try{await api('settings',{roomId:$('room').value,country:$('country').value,exemptUserIds:$('exempt').value.split('\n').map(s=>s.trim()).filter(Boolean)});await refresh(true);notice('Group settings saved. No group messages or removals enabled.');}catch(e){notice(e.message);}};
for(const kind of ['approved','participants']){
 const invalidate=()=>{delete previews[kind];$(kind+'-result').replaceChildren();};
 $(kind+'-csv').addEventListener('input',invalidate);
 $(kind+'-file').onchange=async()=>{try{const file=$(kind+'-file').files[0];if(!file)return;if(file.size>1000000)throw Error('Choose a CSV under 1 MB');$(kind+'-csv').value=await file.text();invalidate();}catch(e){notice(e.message);}};
 $(kind+'-preview').onclick=async()=>{
  try{
   const csv=$(kind+'-csv').value;const preview=await api('import/preview',{kind,csv});previews[kind]={...preview,csv};
   const target=$(kind+'-result');target.className='import-preview';target.replaceChildren(node('strong',`${preview.entries.length} entries · ${preview.issues} with issues`));
   for(const e of preview.entries.slice(0,6)){const item=node('div',`${e.name||'Unnamed'} · ${e.phone||e.phoneRaw||'No number'}${e.reference?' · '+e.reference:''}`,'preview-entry');if(e.issues.length)item.append(node('div',e.issues.join('; '),'issue'));target.append(item);}
   if(preview.entries.length>6)target.append(node('p','Preview shows the first six entries. All entries are kept; unresolved issues remain visible in the comparison.'));
   const label=node('label',undefined,'check');const checkbox=document.createElement('input');checkbox.type='checkbox';label.append(checkbox,node('span','Replace the current list with these entries. Previous decisions may need review.'));
   const button=node('button','Use this list');button.disabled=true;checkbox.onchange=()=>button.disabled=!checkbox.checked;
   button.onclick=async()=>{try{button.disabled=true;await api('import/apply',{kind,csv:previews[kind].csv,expectedVersion:previews[kind].version});invalidate();await refresh();notice('List imported. Check unmatched entries and data-quality issues in the report.');}catch(e){notice(e.message);button.disabled=false;}};
   target.append(label,button);
  }catch(e){invalidate();notice(e.message);}
 };
}
function openReview(row){selected=row;$('review-person').textContent=`${row.name||'Unnamed participant'}\n${row.userId||'No Matrix identity'}\n${row.reason}`;$('outcome').value=row.decision?.outcome||'awaiting-check';$('review-note').value=row.decision?.note||'';$('expiry').value=row.decision?.expiresAt?.slice(0,10)||'';$('review-error').textContent='';$('linked-reference').replaceChildren();const blank=node('option','Select an approved entry');blank.value='';$('linked-reference').append(blank);for(const a of snapshot.approved.filter(a=>a.reference&&!a.issues.length)){const option=node('option',`${a.reference} · ${a.name||'Unnamed'}`);option.value=a.reference;$('linked-reference').append(option);}$('linked-reference').value=row.decision?.linkedReference||'';$('review-dialog').showModal();}
$('close-review').onclick=()=>$('review-dialog').close();
$('review-form').onsubmit=async e=>{e.preventDefault();try{const date=$('expiry').value;const expiresAt=date?new Date(date+'T23:59:59Z').toISOString():null;await api(`participants/${selected.id}/review`,{signature:selected.signature,outcome:$('outcome').value,linkedReference:$('linked-reference').value,note:$('review-note').value,expiresAt});$('review-dialog').close();await refresh();notice('Resolution recorded. No group action taken.');}catch(e){$('review-error').textContent=e.message;}};
$('filter').onchange=()=>snapshot&&render();$('show-numbers').onchange=()=>snapshot&&render();$('refresh').onclick=()=>refresh().catch(e=>notice(e.message));
$('export').onclick=async()=>{try{const data=await api('report');const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='bouncer-review-report.json';link.click();URL.revokeObjectURL(url);notice('Report exported. It contains full phone numbers and organiser notes; share privately.');}catch(e){notice(e.message);}};
initModeration({api,notice,refresh});
if(token)refresh(true).catch(e=>notice(e.message));
setInterval(()=>{if(snapshot)refresh().catch(e=>notice(e.message));},10000);

$('sync-members').onclick=async()=>{const button=$('sync-members');button.disabled=true;try{notice('Retrieving the group member list from the Hub…');const result=await api('participants/sync',{});await refresh();notice(`Synced ${result.count} group members. ${result.missingNumbers} without bridge numbers need a mapping or organiser review.`);}catch(e){notice(e.message);}finally{button.disabled=false;}};
