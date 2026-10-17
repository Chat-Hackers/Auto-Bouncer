import { operate,secureEqual } from './operations.mjs';
import { registrationFor } from './registration.mjs';
export const responseJSON=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',...extra}});
export async function handleRequest(request,{store,identity,origin,hosted=false}){
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
  const context={method:request.method,url,headers,input};
  const result=request.method==='GET'?await operate(await store.read(),context,identity):await store.update(state=>operate(state,context,identity));
  return responseJSON(result.data,result.code);
 }catch(error){
  if(error.status===409)return responseJSON({error:'The group data changed concurrently. Refresh and try again.'},409);
  if(error.storageError){console.error('Bouncer storage request failed');return responseJSON({error:'Database unavailable or not initialised. Check the database setup in DEPLOY-VERCEL.md.'},503);}
  return responseJSON({error:error.message},400);
 }
}
