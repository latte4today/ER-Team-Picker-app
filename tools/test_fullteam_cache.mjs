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
