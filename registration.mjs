export function registrationFor(identity,origin,webhookPath='/'){
 const address=new URL(webhookPath,origin);address.searchParams.set('hook',identity.secret);
 return {id:'whatsapp-bouncer',uuid:identity.uuid,url:address.toString(),emoji:'📋',title:'WhatsApp Bouncer',introduction:'Checks supplied approved numbers and privately flags unmatched participants for organiser review. No automatic removals.',description:'Approved-number checks and organiser exceptions',secret:identity.secret,event_types:['m.room.member']};
}
