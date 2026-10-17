export function registrationFor(identity,origin,webhookPath='/'){
 const address=new URL(webhookPath,origin);address.searchParams.set('hook',identity.secret);
 return {id:'whatsapp-bouncer',uuid:identity.uuid,url:address.toString(),emoji:'🛡️',title:'Auto Bouncer & Moderator',introduction:'Checks approved numbers and flags configured language for organiser review. Group warnings are optional; no automatic removals.',description:'Approved-number checks, word triggers, warnings and organiser review',secret:identity.secret,event_types:['m.room.member','m.room.message']};
}
