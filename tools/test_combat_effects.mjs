import assert from 'node:assert/strict';
import {characterVariants} from '../src/data.js';
import {CORE_EFFECTS,ALLY_HEAL_SKILLS,ALLY_SHIELD_SKILLS} from '../src/combatEffects.js';
import {CURRENT_CORE_NAME_BY_CODE,coreRowForVariant} from '../src/traitMeta.js';
import {matchupProfile} from '../src/matchupGuidance.js';
import {teamCombatPlan} from '../src/teamConcepts.js';
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
globalThis.document={documentElement:{lang:'ko',dataset:{}}};
const {effectiveCombatTeam,recommend,evaluateCandidate,recommendationArchetype}=await import('../src/recommender.js');
const pick=id=>characterVariants.find(c=>c.variantId===id);
const withCore=(id,core)=>effectiveCombatTeam([pick(id)],{[id]:core})[0];
assert.deepEqual(Object.keys(CORE_EFFECTS).sort(),Object.keys(CURRENT_CORE_NAME_BY_CODE).sort(),'every current core has a reviewed mechanical profile');
for(const c of characterVariants){
 if(ALLY_HEAL_SKILLS[c.characterId])assert.ok(c.tags.includes('healing'));
 if(ALLY_SHIELD_SKILLS[c.characterId])assert.ok(c.tags.includes('shield'));
 for(const code of Object.keys(CORE_EFFECTS)){
  const eff=withCore(c.variantId,code);
  for(const tag of ['peel','shield','healing','mobility','speedBoost','selfShield']){
   assert.ok(!eff.tags.includes(tag)||c.tags.includes(tag)||CORE_EFFECTS[code].tags.includes(tag),`${c.variantId}/${code} cannot invent ${tag}`);
   if(c.tags.includes(tag))assert.ok(eff.tags.includes(tag),'a trait cannot remove an intrinsic ability');
  }
 }
}
const vanya=pick('vanya:arcana');
assert.ok(vanya.tags.includes('selfShield')&&!vanya.tags.includes('shield'));
assert.equal(matchupProfile([vanya,pick('rio:bow'),pick('katja:sniper_rifle')]).guard,0,'self shield cannot protect other carries');
const sentinel=withCore('hyunwoo:glove','7200501');
assert.ok(sentinel.tags.includes('shield')&&!sentinel.tags.includes('healing'),'Sentinel shields, not heals');
const heavy=withCore('hyunwoo:glove','7100401');
assert.equal(heavy.effectiveCore.profile.support,0,'Heavy Kneepads has no ally effect');
assert.ok(!heavy.tags.includes('shield')&&!heavy.tags.includes('peel'));
assert.ok(!withCore('rio:bow','7000701').tags.includes('mobility'),'attack speed is not mobility');
const cactus=withCore('rio:bow','7211301');
assert.ok(cactus.effectiveCore.profile.damage>0&&cactus.tags.includes('speedBoost'));
const observed=[{core:'7000701',games:1000,top3Rate:.4}];
assert.equal(coreRowForVariant('rio:bow',observed,'7200301'),null,'no borrowing another core statistics');
assert.equal(evaluateCandidate([],'rio:bow','all',{},[],{'rio:bow':'not-a-core'}),undefined);
assert.equal(recommend([],'all',{},['rio:bow'],[],{'rio:bow':'not-a-core'}).length,0);
const unobserved=withCore('nia:pistol','7200301');
assert.equal(unobserved.effectiveCore.core,'7200301');
assert.ok(unobserved.tags.includes('healing'),'a valid unobserved core still has its own mechanics');
assert.notEqual(recommendationArchetype(pick('seres:two_handed_sword')),'support_utility');
assert.notEqual(recommendationArchetype(pick('cathy:dagger')),'support_utility');
assert.notEqual(recommendationArchetype(vanya),'support_utility');
assert.ok(pick('theodore:sniper_rifle').tags.includes('healing'));
assert.ok(!pick('shirin:rapier').tags.includes('peel'),'self parry is not an allied guard skill');
const unsupported=evaluateCandidate([],'nia:pistol','all',{},[],{'nia:pistol':'7200301'});
assert.equal(unsupported.recommendedCore.core,'7200301');
assert.equal(unsupported.recommendedCore.games,0,'unobserved core cannot inherit the popular core sample');
assert.equal(evaluateCandidate(['rio:bow','katja:sniper_rifle'],'adela:rapier').scores.weaponBalance,-.8,'rapier caster cannot pretend to supply a frontline');
assert.equal(evaluateCandidate(['rio:bow','katja:sniper_rifle'],'silvia:pistol').scores.weaponBalance,.6,'pistol bruiser is not a third backline carry');
const adela=pick('adela:rapier');
assert.equal(teamCombatPlan([adela,pick('rio:bow'),pick('lenox:whip')]).primary,'protectCarry','a melee weapon does not make Adela a melee dealer');
console.log('Combat effects: all 116 variants × 16 current cores; no invented protection/healing/movement; truthful core matching; role/range regressions passed.');
