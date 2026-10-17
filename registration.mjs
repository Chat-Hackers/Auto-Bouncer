import { HUB_TOOL_ID } from './hub-members.mjs';
export function registrationFor(identity,origin,webhookPath='/'){
 const address=new URL(webhookPath,origin);address.searchParams.set('hook',identity.secret);
 return {id:HUB_TOOL_ID,uuid:identity.uuid,url:address.toString(),emoji:'🛡️',title:'Auto Bouncer & Moderator',introduction:'Checks new members against the approved list and can remove anyone not on it. Flags, warns or removes for words you choose.',description:'Approved-number checks, auto-remove and message rules',secret:identity.secret,event_types:['m.room.member','m.room.message']};
}
