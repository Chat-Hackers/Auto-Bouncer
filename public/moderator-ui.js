const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const list=text=>text.split('\n').map(s=>s.trim()).filter(Boolean);
let latest,selected,api,notice,refresh;
function label(text,input){const n=el('label',text);n.append(input);return n;}
function ruleRow(rule={id:crypto.randomUUID(),phrase:'',action:'review',enabled:true,exceptions:[]}){
 const row=el('div',undefined,'mod-rule');row.dataset.id=rule.id;
 const enabled=document.createElement('input');enabled.type='checkbox';enabled.checked=rule.enabled;enabled.dataset.field='enabled';enabled.setAttribute('aria-label','Enable moderation rule');
 const phrase=document.createElement('input');phrase.value=rule.phrase;phrase.maxLength=200;phrase.dataset.field='phrase';
 const action=document.createElement('select');action.dataset.field='action';for(const [value,text] of [['review','Review only'],['warn','Warn + review']]){const option=el('option',text);option.value=value;action.append(option);}action.value=rule.action;
 const except=document.createElement('input');except.value=rule.exceptions.join('; ');except.dataset.field='exceptions';except.placeholder='exception phrase; another phrase';
 const remove=el('button','Remove','secondary');remove.onclick=()=>row.remove();
 row.append(label('',enabled),label('Trigger phrase',phrase),label('Action',action),label('Allow when message contains',except),remove);return row;
}
function readConfig(){return {mode:$('mod-mode').value,rooms:[],exemptSenders:list($('mod-exempt').value),cooldownSeconds:Number($('mod-cooldown').value),warning:$('mod-warning').value,rules:[...$('mod-rules').children].map(row=>({id:row.dataset.id,enabled:row.querySelector('[data-field=enabled]').checked,phrase:row.querySelector('[data-field=phrase]').value,action:row.querySelector('[data-field=action]').value,exceptions:row.querySelector('[data-field=exceptions]').value.split(';').map(s=>s.trim()).filter(Boolean)}))};}
export function renderModeration(snapshot,settings=false){
 latest=snapshot;const m=snapshot.moderation;if(!m)return;
 if(settings){const c=m.config;$('mod-mode').value=c.mode;$('mod-warning').value=c.warning;$('mod-cooldown').value=c.cooldownSeconds;$('mod-exempt').value=c.exemptSenders.join('\n');$('mod-rules').replaceChildren(...c.rules.map(ruleRow));}
 $('mod-badge').textContent=m.config.mode==='live'&&!snapshot.isDemo?'LIVE · GROUP WARNINGS':'DEMO · NO GROUP RESPONSES';
 const stats=[['Message flags',m.incidents.length],['Awaiting review',m.incidents.filter(i=>i.status==='pending').length],['False positives',m.incidents.filter(i=>i.status==='false-positive').length],['Confirmed concerns',m.incidents.filter(i=>i.status==='confirmed').length]];
 $('mod-stats').replaceChildren(...stats.map(([text,count])=>{const n=el('div',undefined,'stat');n.append(el('strong',String(count)),el('small',text));return n;}));
 const shown=m.incidents.filter(i=>$('mod-filter').value==='all'||i.status===$('mod-filter').value);
 $('mod-incidents').className=shown.length?'':'empty';$('mod-incidents').replaceChildren();
 if(!shown.length)$('mod-incidents').textContent='No flags in this view. Incoming matching messages will appear here.';
 for(const incident of shown){
  const article=el('article',undefined,'mod-incident');
  const person=snapshot.rows.find(p=>p.userId===incident.sender);
  const heading=el('div',undefined,'section-head');heading.append(el('small',`${new Date(incident.receivedAt).toLocaleString('en-GB',{timeZone:'Europe/London'})} · London time`),el('span',incident.status,'status'));
  article.append(heading,el('p',incident.text,'mod-message'),el('small',`${incident.displayName} · ${incident.sender}`),el('p',`Participant check: ${person?person.status:'not in the current roster'} · Triggers: ${incident.matches.map(m=>m.phrase).join(', ')} · Warning: ${incident.warning}`,'hint'));
  if(incident.note)article.append(el('p','Review note: '+incident.note,'hint'));
  const button=el('button',incident.status==='pending'?'Review message':'Update message review','secondary');
  button.onclick=()=>{selected=incident.id;$('mod-review-text').textContent=incident.text;$('mod-decision').value=incident.status==='pending'?'confirmed':incident.status;$('mod-note').value=incident.note;$('mod-error').textContent='';$('mod-dialog').showModal();};
  article.append(button);$('mod-incidents').append(article);
 }
}
export function initModeration(dependencies){
 ({api,notice,refresh}=dependencies);
 $('mod-add').onclick=()=>$('mod-rules').append(ruleRow());
 $('mod-save').onclick=async()=>{const button=$('mod-save');button.disabled=true;try{await api('moderation/config',readConfig());await refresh(true);notice('Moderation settings saved. The mode badge shows whether group warnings are enabled.');}catch(e){notice(e.message);}finally{button.disabled=false;}};
 async function simulate(){try{const result=await api('moderation/simulate',{text:$('mod-text').value,sender:$('mod-sender').value,config:readConfig()});const target=$('mod-result');target.className='mod-test-result';target.replaceChildren(el('h3',result.ignored?'Ignored sender':result.matches.length?'Flagged for review':'No trigger matched'));for(const m of result.matches)target.append(el('p',`${m.phrase} → ${m.action==='warn'?'warning + review':'review only'}`));for(const e of result.exceptions||[])target.append(el('p',`Allowed by exception: ${e.phrase}`));if(result.proposedWarning)target.append(el('p','Proposed warning: '+result.proposedWarning));target.append(el('p','Simulation only. No group message or review-queue entry was created.','hint'));}catch(e){notice(e.message);}}
 $('mod-test').onclick=simulate;$('mod-example').onclick=()=>{$('mod-text').value='Please don’t call people an idiot.';simulate();};
 $('mod-filter').onchange=()=>latest&&renderModeration(latest);
 $('mod-close').onclick=()=>$('mod-dialog').close();
 $('mod-review-form').onsubmit=async e=>{e.preventDefault();try{await api(`moderation/incidents/${selected}/review`,{status:$('mod-decision').value,note:$('mod-note').value});$('mod-dialog').close();await refresh();notice('Message review recorded. No deletion or membership action was taken.');}catch(e){$('mod-error').textContent=e.message;}};
}
