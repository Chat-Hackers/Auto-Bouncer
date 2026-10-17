import fs from 'node:fs';
import { randomBytes,randomUUID } from 'node:crypto';
const file='.env.vercel.local';
if(fs.existsSync(file))throw Error('The private environment file already exists; reuse it instead of generating new secrets.');
const contents=`ADMIN_TOKEN=${randomBytes(32).toString('base64url')}\nMODULE_SECRET=${randomBytes(32).toString('base64url')}\nMODULE_UUID=${randomUUID()}\nBOUNCER_INSTANCE_ID=whatsapp-bouncer-production\n`;
fs.writeFileSync(file,contents,{mode:0o600,flag:'wx'});
console.log(`Private values written to ${file}. Copy them into Vercel Production environment variables. Do not upload or commit this file.`);
