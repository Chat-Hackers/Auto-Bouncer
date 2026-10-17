import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { handleRequest } from './handler.mjs';
import { initialState } from './operations.mjs';
import { optimisticStore } from './storage.mjs';
import { digest } from './bouncer.mjs';
import { registrationFor } from './registration.mjs';
if(fs.existsSync('.env'))loadEnvFile('.env');
const root=path.dirname(fileURLToPath(import.meta.url));
const dir=path.resolve(process.env.DATA_DIR||'data');fs.mkdirSync(dir,{recursive:true});
const read=(file,fallback)=>fs.existsSync(path.join(dir,file))?JSON.parse(fs.readFileSync(path.join(dir,file),'utf8')):fallback;
function write(file,value){const target=path.join(dir,file);fs.writeFileSync(target+'.tmp',JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(target+'.tmp',target);}
const identity=read('identity.json',{uuid:randomUUID(),secret:randomUUID(),adminToken:randomUUID()});
if(process.env.MODULE_SECRET)identity.secret=process.env.MODULE_SECRET;
if(process.env.ADMIN_TOKEN)identity.adminToken=process.env.ADMIN_TOKEN;
write('identity.json',identity);
const store=optimisticStore({
 load:async()=>{const data=read('state.json',initialState());return {revision:digest(data),data};},
 compareAndSwap:async(revision,data)=>{if(digest(read('state.json',initialState()))!==revision)return false;write('state.json',data);return true;}
});
const origin=process.env.PUBLIC_URL||`http://localhost:${process.env.PORT||5059}`;
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};
  if(req.method==='GET'&&files[url.pathname]){
   const file=files[url.pathname];res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff'});res.end(fs.readFileSync(path.join(root,'public',file)));return;
  }
  const request=new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Readable.toWeb(req),duplex:'half'})});
  const response=await handleRequest(request,{store,identity,origin,hubOrigin:process.env.HUB_URL});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Local server request failed'}));}
});
server.listen(Number(process.env.PORT||5059),process.env.HOST||'127.0.0.1',()=>{
 const registration=registrationFor(identity,origin);write('whatsapp-bouncer.json',registration);
 console.log(`WhatsApp Bouncer: http://127.0.0.1:${process.env.PORT||5059}\nOrganiser token: ${identity.adminToken}\nRegistration JSON (share privately):\n${JSON.stringify(registration,null,2)}\nSaved to ${path.join(dir,'whatsapp-bouncer.json')}`);
});
