import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, evaluate, containsPhrase, validateConfig } from '../moderation.mjs';
const event = text => ({event_id:'$test',room_id:'!room:test',sender:'@person:test',type:'m.room.message',content:{msgtype:'m.text',body:text}});
test('whole words prevent substring false positives and rules handle Unicode',()=>{
  assert.equal(containsPhrase('You are an IDIOT!','idiot'),true);
  assert.equal(containsPhrase('An idiotic suggestion','idiot'),false);
  assert.equal(containsPhrase('ＳＨＵＴ　ＵＰ','shut up'),true);
  assert.equal(containsPhrase('i\u200Bdiot','idiot'),true);
  assert.equal(containsPhrase('special C++ example','C++'),true);
  assert.equal(containsPhrase('Scunthorpe','cunt'),false);
});
test('exceptions apply per rule, disabled rules do not match',()=>{
  const config=defaults();config.rules[0].exceptions=['don’t call people'];
  const result=evaluate(event('Please don’t call people an idiot. Shut up.'),config);
  assert.deepEqual(result.matches.map(m=>m.ruleId),['aggressive-language']);
  assert.equal(result.exceptions.length,1);
  config.rules[1].enabled=false;
  assert.equal(evaluate(event('shut up'),config).matches.length,0);
});
test('demonstrates context false positive rather than claiming semantic judgement',()=>{
  assert.equal(evaluate(event('Please don’t call people an idiot.'),defaults()).matches.length,1);
});
test('ignores bots and exemptions; strips quoted reply fallback; handles edits',()=>{
  const config=defaults();config.exemptSenders=['@person:test'];
  assert.equal(evaluate(event('idiot'),config).ignored,'Bot or exempt sender');
  assert.ok(evaluate(event('idiot'),defaults(),'@person:test').ignored);
  const reply=event('> <@other:test> idiot\n\nThanks for explaining.');
  reply.content['m.relates_to']={'m.in_reply_to':{event_id:'$old'}};
  assert.equal(evaluate(reply,defaults()).matches.length,0);
  const edit=event('* old body');edit.content['m.relates_to']={rel_type:'m.replace',event_id:'$old'};edit.content['m.new_content']={msgtype:'m.text',body:'You are an idiot'};
  assert.equal(evaluate(edit,defaults()).matches.length,1);
});
test('invalid configs cannot enable unsupported actions or unconstrained live rooms',()=>{
  assert.throws(()=>validateConfig({...defaults(),mode:'live'}),/room/);
  const config=defaults();config.rules[0].action='ban';assert.throws(()=>validateConfig(config),/review, warn or remove/);
  assert.throws(()=>validateConfig({...defaults(),cooldownSeconds:0}),/cooldown/);
});
