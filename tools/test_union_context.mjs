import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const app = await fs.readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const slice = (start, end) => app.slice(app.indexOf(start), app.indexOf(end));
const source = slice('function unionComboScore(', 'function unionComboReason(')
  + slice('async function buildUnionCombos(', 'function renderUnionComboResults(')
  + slice('function unionRecommendationKey(', 'function savePlayableCharacters(');
const tiers = new Set();
const variants = new Map();
const rosters = [0,1,2].map(p => new Set(Array.from({length:6}, (_,i) => {
  const id = `p${p}c${i}:bow`;
  variants.set(id, {variantId:id, characterId:`p${p}c${i}`});
  return id;
})));
let yields = 0;
let changeDuringCalculation = true;
let rendered = false;
const state = {
  tierSelect:{value:'all'}, remoteFeedback:{}, currentRelationshipRows:()=>[],
  officialStatsVersion:'one',tournamentStatsVersion:'one', getLanguage:()=> 'ko', dataSignature:JSON.stringify,
  activeUnionPlayers:()=>[0,1,2], unionRosters:rosters, variantById:id=>variants.get(id),
  isUnionCalculating:false, _unionComboCache:[], _unionResultKey:'',
  unionSummary:{dataset:{},removeAttribute:()=>{}}, unionResults:{innerHTML:''},
  t:key=>key, updateUnionCalculateButton:()=>{},
  renderUnionPlayers:()=>{}, renderUnionRoleFilters:()=>{}, renderUnionCharacters:()=>{},
  renderUnionResultPrecheck:()=>true,
  renderUnionComboResults:()=>{rendered=true;},
  evaluateCandidate:(ids, candidate, tier)=>{tiers.add(tier); return {score:1,reasons:[]};},
  yieldToUi:async()=>{if (++yields===2 && changeDuringCalculation) state.tierSelect.value='iron_gold';},
};
vm.createContext(state);
vm.runInContext(source, state);
await state.renderUnionResults();
assert.deepEqual([...tiers],['all'], 'the entire scoring pass uses its initial tier');
assert.equal(rendered,false,'outdated results are not displayed');
assert.equal(state._unionComboCache.length,0);
assert.equal(state.isUnionCalculating,false);
tiers.clear(); changeDuringCalculation=false;
await state.renderUnionResults();
assert.ok(rendered);
assert.equal(state._unionComboCache.length,24);
assert.deepEqual([...tiers],['iron_gold']);
state.tournamentStatsVersion='two';
state.renderUnion();
assert.equal(state._unionComboCache.length,0,'new tournament data invalidates completed union results');
console.log('Union context regression passed: fixed scoring context, stale async results discarded, completed results invalidated.');
