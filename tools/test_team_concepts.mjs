import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { characterVariants } from '../src/data.js';
import { teamConcepts, teamCombatPlan } from '../src/teamConcepts.js';
let language='ko';
globalThis.localStorage={getItem:()=>language,setItem:(_,value)=>{language=value;}};
globalThis.document={documentElement:{}};
const { t,setLanguage }=await import('../src/i18n/index.js');
const { effectiveCombatTeam, evaluateCandidate }=await import('../src/recommender.js');
const team=ids=>ids.map(id=>characterVariants.find(c=>c.variantId===id));
const sustainTeam=team(['luke:bat','sho:spear','rio:bow']);
assert.ok(teamConcepts(effectiveCombatTeam(sustainTeam,{'luke:bat':'7200301','sho:spear':'7200301'})).includes('attrition'));
assert.ok(!teamConcepts(effectiveCombatTeam(sustainTeam,{'luke:bat':'7100501','sho:spear':'7200201'})).includes('attrition'),
  'selected cores, not only character names, determine the sustain concept');
const guarded=team(['lenox:whip','nicky:glove','lucia:sniper_rifle']);
assert.deepEqual(teamCombatPlan(guarded),{primary:'protectCarry',supports:['stopEntry']},
  'a guard anchor plus ranged CC helper is a counter-engage plan, not a two-person dive');
for (const order of [guarded,[guarded[2],guarded[0],guarded[1]],[guarded[1],guarded[2],guarded[0]]])
  assert.deepEqual(teamCombatPlan(order),teamCombatPlan(guarded),'the plan does not depend on slot order');
assert.ok(teamConcepts(team(['rio:bow','katja:sniper_rifle','adriana:throw'])).includes('pokeZone'));
assert.ok(teamConcepts(team(['yuki:two_handed_sword','debi_marlene:two_handed_sword','lucia:sniper_rifle'])).includes('engageFollow'));
assert.deepEqual(teamConcepts(team(['leni:pistol','johann:arcana','priya:guitar'])),[],
  'sustain/control alone does not justify a winning concept without a damage source');
assert.deepEqual(teamConcepts(sustainTeam.slice(0,2)),[]);
assert.deepEqual(teamConcepts([sustainTeam[0],sustainTeam[0],sustainTeam[2]]),[]);
const source=await fs.readFile(new URL('../src/app.js',import.meta.url),'utf8');
const context={t};vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function compactReasonLabels('),source.indexOf('function compactReasonText(')),context);
const positive=context.compactReasonLabels(['팀 전체 CC가 부족합니다.','후보의 데미지 기여가 충분합니다.']);
assert.ok(!positive.includes(t('compact.damageLow'))&&!positive.includes(t('compact.damageCaution')),
  'a separate CC shortage cannot turn adequate damage into a warning');
assert.ok(context.compactReasonLabels(['후보의 데미지 기여가 부족합니다.']).includes(t('compact.damageLow')));
for(const locale of ['ko','en','ja','zhHans','zhHant']){
  setLanguage(locale);
  const evaluated=evaluateCandidate(['luke:bat','rio:bow'],'sho:spear','all',{},[],
    {'luke:bat':'7200301','sho:spear':'7200301'});
  assert.ok(evaluated.scores.teamDamageBudget<=-1.4,'reproduce the actual core-adjusted damage deficit');
  assert.ok(evaluated.scores.metricBalance>=0.65,'reproduce the independently positive skill rating');
  assert.ok(evaluated.reasons.includes(t('recommender.reason.tooManyLowDamage')));
  assert.ok(!evaluated.reasons.some(reason=>reason.includes(t('metric.tag.damageHigh'))
    ||reason.includes(t('metric.tag.damageLow'))),'skill ratings cannot overrule actual damage assessment');
  assert.ok(context.compactReasonLabels([t('recommender.reason.tooManyLowDamage')]).includes(t('compact.damageLow')));
  const warning=t('recommender.reason.tankLowDamageWithAvg',{nameSubject:'Sample',avgDamage:'10,000'});
  assert.ok(context.compactReasonLabels([warning]).includes(t('compact.damageLow')),
    'localized model damage warnings retain their meaning in every language');
  for(const key of ['compact.damageLow','compact.damageCaution','compact.caution'])assert.ok(context.renderReasonTag(t(key)).includes('tag-negative'));
  assert.ok(context.renderReasonTag(t('compact.damageOk')).includes('tag-neutral'));
  for(const concept of ['attrition','controlFocus','protectCarry','engageFollow','pokeZone'])
    for(const part of ['label','plan'])assert.notEqual(t(`concept.${concept}.${part}`),`concept.${concept}.${part}`);
  for(const key of ['concept.supportTitle','concept.support.stopEntry','concept.support.chainControl','concept.support.recovery','recommender.reason.metricCapabilities'])
    assert.notEqual(t(key),key);
}
setLanguage('ko');
const mixed=context.compactReasonLabels(['데미지 기여가 충분합니다.',t('recommender.reason.tooManyLowDamage')]);
assert.ok(mixed.includes(t('compact.damageLow'))&&!mixed.includes(t('compact.damageOk')),
  'adequate individual damage does not remove the whole-team shortage');
context.teamCombatPlan=teamCombatPlan;
context.displayCombatTeam=team=>team;
vm.runInContext(source.slice(source.indexOf('function unionComboPlan('),source.indexOf('function yieldToUi(')),context);
assert.equal(context.unionComboPlan(guarded),t('concept.protectCarry.plan'),
  'Union instructions agree with the primary plan instead of an earlier generic engage rule');
console.log('Team diagnosis passed: one primary plan, defensive CC vs dive, slot invariance, core-dependent sustain, actual contradictory-damage regression and warning tags in five locales.');
