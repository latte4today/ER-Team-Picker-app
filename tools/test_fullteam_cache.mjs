import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the application's real async functions without rendering the entire DOM.
const app = await fs.readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const source = app.slice(app.indexOf('function fullTeamRecommendationKey('), app.indexOf('function _renderFullTeamCards('));
let calls = 0;
let mutateOnYield = null;
const state = {
  chosenPickId: 'seres:two_handed_sword', tierSelect: { value: 'all' },
  playableVariantIds: new Set(), officialStatsVersion: 'one', tournamentStatsVersion: 'one', remoteFeedback: {},
  relationships: [], cores: {}, _fullTeamState: { status: 'idle' },
  language: 'ko', getLanguage: () => state.language,
  recommendations: { querySelector: () => true },
  selectedCoresMap: () => state.cores,
  currentRelationshipRows: () => state.relationships,
  dataSignature: JSON.stringify,
  _renderFullTeamCards: () => {},
  yieldToUi: async () => { if (mutateOnYield) { const fn = mutateOnYield; mutateOnYield = null; fn(); } },
  recommend: (selected, tier, feedback, pool, relationships, cores) => {
    calls++;
    if (selected.length === 2) assert.equal(cores[selected[1]], '7200301', 'first teammate core is part of the second recommendation');
    const id = `${tier}-${selected.length}:bow`;
    return [{ character: { variantId: id, characterId: id }, score: 1, recommendedCore: { core: '7200301', name: 'Healing Drone' } }];
  },
};
vm.createContext(state);
vm.runInContext(source, state);
await state.renderFullTeamRecommendations();
const initialCalls = calls;
await state.renderFullTeamRecommendations();
assert.equal(calls, initialCalls, 'unchanged inputs reuse the completed result');
for (const change of [
  () => { state.tierSelect.value = 'iron_bronze'; },
  () => { state.playableVariantIds.add('rio:bow'); },
  () => { state.cores = { 'seres:two_handed_sword': '7200301' }; },
  () => { state.officialStatsVersion = 'two'; },
  () => { state.tournamentStatsVersion = 'two'; },
  () => { state.remoteFeedback = { 'rio:bow': 1 }; },
  () => { state.relationships = [{ candidateId: 'rio:bow' }]; },
  () => { state.language = 'en'; },
]) {
  const before = calls;
  change();
  await state.renderFullTeamRecommendations();
  assert.ok(calls > before, 'changed recommendation inputs require fresh results');
}
state.tierSelect.value = 'meteor_mithril';
mutateOnYield = () => { state.chosenPickId = 'lucia:sniper_rifle'; };
const before = calls;
await state.renderFullTeamRecommendations();
assert.equal(calls, before, 'obsolete async computation must stop before scoring');
console.log('Full-team cache regression passed: 8 input changes recompute; unchanged inputs reuse; obsolete computation stops.');

// Duplicate cores used to consume the entire beam, and the first discovered
// pair won even when a later reverse path had a higher score.
const row=(id,total,core='7200301')=>({character:{variantId:`${id}:bow`,characterId:id},score:Number(total.toFixed(1)),total,recommendedCore:{core}});
state.recommend=(selected)=>{
 if(selected.length===1)return [row('a',10),row('a',9,'7100501'),row('b',8),row('c',7)];
 if(selected[1]==='a:bow')return [row('b',1),row('b',0.9,'7100501'),row('c',0.8),row('d',0.7)];
 if(selected[1]==='b:bow')return [row('a',6.04),row('e',1)];
 return [row('f',1)];
};
assert.deepEqual(Array.from(state.topDistinctTeammates(state.recommend(['anchor']),3),r=>r.character.characterId),['a','b','c']);
state._fullTeamState={status:'idle'};
await state.renderFullTeamRecommendations();
const pairs=state._fullTeamState.compositions;
const ab=pairs.find(p=>[p.teammate1.character.characterId,p.teammate2.character.characterId].sort().join('|')==='a|b');
assert.equal(ab.combinedRank,14.04,'retain the better reverse path using unrounded scores');
assert.equal(ab.teammate1.character.characterId,'b');
assert.ok(pairs.some(p=>p.teammate2.character.characterId==='d'),'duplicate cores cannot crowd out a third distinct teammate');
assert.equal(new Set(pairs.map(p=>[p.teammate1.character.characterId,p.teammate2.character.characterId].sort().join('|'))).size,pairs.length);
console.log('Full-team search regression passed: distinct teammate branches and strongest duplicate path.');
