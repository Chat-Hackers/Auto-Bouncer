import { initialState } from './operations.mjs';
// Compare-and-swap is atomic in Postgres. Each retry recomputes a pure operation;
// these operations have no external sends or removal side effects.
export function optimisticStore({load,compareAndSwap},attempts=4){
 return {read:async()=>structuredClone((await load()).data),update:async operation=>{
  for(let i=0;i<attempts;i++){
   const current=await load();const result=await operation(structuredClone(current.data));
   if(!result.changed||result.code>=400)return result;
   if(Buffer.byteLength(JSON.stringify(result.state))>2000000)throw Error('This prototype has reached its 2 MB data limit. Export the report and archive data before continuing.');
   if(await compareAndSwap(current.revision,result.state))return result;
  }
  const error=new Error('Concurrent update conflict');error.status=409;throw error;
 }};
}
export function neonStore(sql,instanceId){
 const protect=fn=>async(...args)=>{try{return await fn(...args);}catch(error){const safe=new Error('Database request failed');safe.storageError=true;throw safe;}};
 const load=protect(async()=>{
  await sql.query('INSERT INTO bouncer_state (id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO NOTHING',[instanceId,JSON.stringify(initialState())]);
  const rows=await sql.query('SELECT revision::text AS revision, data FROM bouncer_state WHERE id = $1',[instanceId]);
  if(!rows[0])throw Error('Missing state row');return rows[0];
 });
 const compareAndSwap=protect(async(revision,data)=>{
  const rows=await sql.query('UPDATE bouncer_state SET data = $1::jsonb, revision = revision + 1, updated_at = now() WHERE id = $2 AND revision = $3::bigint RETURNING revision',[JSON.stringify(data),instanceId,revision]);return rows.length===1;
 });
 return optimisticStore({load,compareAndSwap});
}
