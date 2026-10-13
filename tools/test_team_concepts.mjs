import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { characterVariants } from '../src/data.js';
import { teamConcepts } from '../src/teamConcepts.js';
let language='ko';
globalThis.localStorage={getItem:()=>language,setItem:(_,value)=>{language=value;}};
globalThis.document={documentElement:{}};
const { t,setLanguage }=await import('../src/i18n/index.js');
const { effectiveCombatTeam }=await import('../src/recommender.js');
const team=ids=>ids.map(id=>characterVariants.find(c=>c.variantId===id));
const sustainTeam=team(['luke:bat','sho:spear','rio:bow']);
assert.ok(teamConcepts(effectiveCombatTeam(sustainTeam,{'luke:bat':'7200301','sho:spear':'7200301'})).includes('attrition'));
assert.ok(!teamConcepts(effectiveCombatTeam(sustainTeam,{'luke:bat':'7100501','sho:spear':'7200201'})).includes('attrition'),
  'selected cores, not only character names, determine the sustain concept');
assert.ok(teamConcepts(team(['lenox:whip','nicky:glove','lucia:sniper_rifle'])).includes('controlFocus'));
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
  const warning=t('recommender.reason.tankLowDamageWithAvg',{nameSubject:'Sample',avgDamage:'10,000'});
  assert.ok(context.compactReasonLabels([warning]).includes(t('compact.damageLow')),
    'localized model damage warnings retain their meaning in every language');
  for(const key of ['compact.damageLow','compact.damageCaution','compact.caution'])assert.ok(context.renderReasonTag(t(key)).includes('tag-negative'));
  assert.ok(context.renderReasonTag(t('compact.damageOk')).includes('tag-neutral'));
  for(const concept of ['attrition','controlFocus','protectCarry','engageFollow','pokeZone'])
    for(const part of ['label','plan'])assert.notEqual(t(`concept.${concept}.${part}`),`concept.${concept}.${part}`);
}
console.log('Team concepts and warning tags passed: core-dependent sustain, control/focus, follow-up, poke, incomplete/no-damage exclusions, false-shortage regression and five locales.');
