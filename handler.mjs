import { operate,secureEqual,recordKicks } from './operations.mjs';
import { registrationFor } from './registration.mjs';
import { fetchMemberSnapshot,sendKicks } from './hub-members.mjs';
export const responseJSON=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',...extra}});
export async function handleRequest(request,{store,identity,origin,hosted=false,hubOrigin,hubFetch}){
 const url=new URL(request.url);
 // Vercel rewrites pass an internal route; authentication still applies to every route.
 if(hosted&&url.searchParams.has('__route'))url.pathname=url.searchParams.get('__route');
 const headers={authorization:request.headers.get('authorization')};
 try{
  if(request.method==='GET'&&url.pathname==='/health'){
    await store.read();return responseJSON({ok:true});
  }
  const webhook=request.method==='POST'&&url.pathname==='/';
  if(webhook){if(!secureEqual(url.searchParams.get('hook'),identity.secret))return responseJSON({error:'Invalid webhook secret'},401);}
  else if(url.pathname.startsWith('/api/')){if(!secureEqual(headers.authorization,`Bearer ${identity.adminToken}`))return responseJSON({error:'Enter your organiser access token'},401);}
  else return responseJSON({error:'Not found'},404);
  if(request.method==='GET'&&url.pathname==='/api/registration'){
    if(!origin)return responseJSON({error:'Set PUBLIC_URL to the stable production address and redeploy'},503);
    return responseJSON(registrationFor(identity,origin,hosted?'/webhook':'/'),200,{'Content-Disposition':'attachment; filename="whatsapp-bouncer.json"'});
  }
  let input={};
  if(request.method!=='GET'){
    const length=Number(request.headers.get('content-length')||0);if(length>1500000)return responseJSON({error:'Request too large'},413);
    let text='';const reader=request.body?.getReader();if(reader){const decoder=new TextDecoder();let bytes=0;while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>1500000){await reader.cancel();return responseJSON({error:'Request too large'},413);}text+=decoder.decode(chunk.value,{stream:true});}text+=decoder.decode();}
    input=JSON.parse(text||'{}');
  }
  if(request.method==='POST'&&url.pathname==='/api/participants/sync'){
    const state=await store.read();
    if(state.isDemo)throw Error('Clear the labelled demo before syncing a real group');
    if(!state.settings.roomId)throw Error('Save your group room ID before syncing');
    // Fetch once outside database retries; browser payloads cannot supply a trusted roster.
    input=await fetchMemberSnapshot(hubOrigin,state.settings.roomId,identity.secret,hubFetch);
  }
  const context={method:request.method,url,headers,input};
  const result=request.method==='GET'?await operate(await store.read(),context,identity):await store.update(state=>operate(state,context,identity));
  // Removals are sent once, after the decision is committed, never inside a retried operation.
  if(result.kicks?.length&&result.code<400){
    const outcomes=await sendKicks(hubOrigin,result.state.settings.roomId,identity.secret,result.kicks,hubFetch);
    await store.update(state=>recordKicks(state,outcomes)).catch(()=>console.error('Could not record removal outcome'));
    if(url.pathname.startsWith('/api/')&&outcomes.some(o=>!o.ok))return responseJSON({error:'The Hub did not accept the removal: '+outcomes.find(o=>!o.ok).error},502);
  }
  return responseJSON(result.data,result.code);
 }catch(error){
  if(error.status===409)return responseJSON({error:'The group data changed concurrently. Refresh and try again.'},409);
  if(error.storageError){console.error('Bouncer storage request failed');return responseJSON({error:'Database unavailable or not initialised. Check the database setup in DEPLOY-VERCEL.md.'},503);}
  return responseJSON({error:error.message},400);
 }
}
