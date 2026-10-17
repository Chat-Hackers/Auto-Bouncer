import { handleRequest,responseJSON } from '../handler.mjs';
import { neonStore } from '../storage.mjs';
import { digest } from '../bouncer.mjs';
let runtime;
export async function getRuntime(env=process.env){
 const required=['DATABASE_URL','ADMIN_TOKEN','MODULE_SECRET','BOUNCER_INSTANCE_ID'];
 if(required.some(name=>!env[name]))throw Error('Missing required server configuration');
 if(env.ADMIN_TOKEN.length<24||env.MODULE_SECRET.length<24||env.ADMIN_TOKEN===env.MODULE_SECRET)throw Error('Use distinct access and webhook secrets of at least 24 characters');
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(env.BOUNCER_INSTANCE_ID))throw Error('Invalid instance id');
 const {neon}=await import('@neondatabase/serverless');
 const hash=digest(env.MODULE_SECRET);
 return {store:neonStore(neon(env.DATABASE_URL),env.BOUNCER_INSTANCE_ID),identity:{adminToken:env.ADMIN_TOKEN,secret:env.MODULE_SECRET,uuid:env.MODULE_UUID||`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`},origin:env.PUBLIC_URL,hosted:true};
}
export default {
 async fetch(request){
  if(!runtime){try{runtime=await getRuntime();}catch{return responseJSON({error:'Deployment setup incomplete. Set the required environment variables in Vercel and redeploy; see DEPLOY-VERCEL.md.'},503);}}
  return handleRequest(request,runtime);
 }
};
