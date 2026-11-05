import assert from 'node:assert/strict';
import { characterVariants } from '../src/data.js';
import { compareMatchup, matchupGuidance, matchupProfile } from '../src/matchupGuidance.js';
import { tournamentBuilds } from '../src/tournamentMeta.js';
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
const { setLanguage,t }=await import('../src/i18n/index.js');
const { effectiveCombatTeam }=await import('../src/recommender.js');
globalThis.document={documentElement:{}};
const team=ids=>ids.map(id=>characterVariants.find(c=>c.variantId===id));
const ranged=team(['rio:bow','katja:sniper_rifle','adriana:throw']);
const dive=team(['yuki:two_handed_sword','yan:glove','aiden:two_handed_sword']);
const protectedTeam=team(['seres:two_handed_sword','rio:bow','lucia:sniper_rifle']);
assert.equal(compareMatchup(ranged,dive).reason,'exposedBackline');
assert.equal(compareMatchup(protectedTeam,dive).reason,'protectAndCounter');
assert.equal(matchupProfile(team(['adela:rapier','rio:bow','lenox:whip'])).ranged,2,
  'rapier Adela is a ranged caster, not a second melee initiator');
assert.equal(matchupProfile(team(['silvia:pistol','rio:bow','lenox:whip'])).ranged,1,
  'pistol Silvia is a bruiser, not a ranged carry');
assert.notEqual(compareMatchup(team(['leni:pistol','johann:arcana','priya:guitar']),dive)?.kind,'opportunity',
  'protection without damage cannot be presented as a favorable counter-engage team');
const lukeTeam=team(['luke:bat','rio:bow','lucia:sniper_rifle']);
assert.equal(compareMatchup(effectiveCombatTeam(lukeTeam,{'luke:bat':'7200301'}),dive).reason,'protectAndCounter');
assert.equal(compareMatchup(effectiveCombatTeam(lukeTeam,{'luke:bat':'7100501'}),dive).reason,'exposedBackline',
  'the actual selected core can change protection and the opponent advice');
assert.equal(compareMatchup(dive,team(['rozzi:pistol','chloe:shuriken','craver:pistol'])).kind,'opportunity');
assert.equal(compareMatchup(ranged.slice(0,2),dive),null);
assert.deepEqual(matchupGuidance([ranged[0],ranged[0],ranged[1]],[],()=>[]),[]);
const refs=tournamentBuilds;
const resolve=row=>team(row.members.map(m=>m.variantId));
const rows=matchupGuidance(protectedTeam,refs,resolve);
assert.ok(rows.length>0);
assert.ok(rows.some(row=>row.examples.length>1),'show several distinct observed opponents when available');
assert.equal(compareMatchup(protectedTeam,[...protectedTeam].reverse()),null,'a mirror is not an advantage');
assert.equal(compareMatchup([undefined,...protectedTeam.slice(1)],dive),null);
assert.deepEqual(matchupGuidance([...protectedTeam].reverse(),[...refs].reverse(),resolve),
  matchupGuidance(protectedTeam,refs,resolve),'slot and input order must not shuffle opponent examples');
for(const row of rows){
  const lineups=row.examples.map(e=>e.members.map(m=>m.variantId.split(':')[0]).sort().join('|'));
  assert.equal(new Set(lineups).size,lineups.length,'core-only variations cannot fill the examples');
  for(const example of row.examples){
    assert.ok(example.ownActors.length>0&&example.enemyActors.length>0);
    assert.ok(example.ownActors.every(id=>protectedTeam.some(c=>c.variantId===id)));
    assert.ok(example.enemyActors.every(id=>example.members.some(m=>m.variantId===id)));
    assert.ok(Number.isFinite(example.relevance));
  }
}
const duplicateRows=matchupGuidance(protectedTeam,[...refs,...refs],resolve);
assert.deepEqual(duplicateRows,rows,'duplicate references must not inflate relevance or appearances');
const opponentKeys = ids => matchupGuidance(effectiveCombatTeam(team(ids)),refs,
  row=>effectiveCombatTeam(resolve(row),Object.fromEntries(row.members.map(m=>[m.variantId,m.core]))))
  .find(row=>row.reason==='protectAndCounter').examples.map(e=>e.key);
assert.notDeepEqual(opponentKeys(['lenox:whip','rio:bow','eva:throw']),
  opponentKeys(['lenox:whip','rozzi:pistol','barbara:pistol']),
  'same guard and same matchup category must still compare the actual carries');
for(const row of rows)assert.ok(row.examples.every(e=>refs.some(r=>r.members===e.members)), 'examples must be actual observed builds');
const languages=['ko','en','ja','zhHans','zhHant'];
let language='ko';globalThis.localStorage={getItem:()=>language,setItem:(_,value)=>{language=value;}};
for(const lang of languages){setLanguage(lang);for(const key of ['title','basis','caution','opportunity','example','source','exposedBackline','deniedEngage','approachUnderFire','protectAndCounter','catchBackline','holdRange',...['exposedBackline','deniedEngage','approachUnderFire','protectAndCounter','catchBackline','holdRange'].map(k=>'detail.'+k)])assert.notEqual(t('matchup.'+key),'matchup.'+key);}
console.log('Matchup guidance: real three-build comparisons, protection changes advice, observed examples and five locales passed.');
