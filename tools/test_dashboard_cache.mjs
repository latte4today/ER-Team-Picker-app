import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import {combatRangeOf} from '../src/combatEffects.js';
import {calibratedRankScore,rankBaseline,isValidRankStat} from '../src/rankQuality.js';
globalThis.localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
globalThis.document={documentElement:{lang:'ko',dataset:{}}};
const {characterVariants}=await import('../src/data.js');
const meta=await import('../src/metaData.js');
const official=await import('../src/officialMatchStats.js');
const current=await fs.readFile(new URL('../src/app.js',import.meta.url),'utf8');
const make = source => {
  const context={calibratedRankScore,rankBaseline,isValidRankStat,isCurrentSeason:()=>true,officialStatsSource:{},characterVariants,...meta,...official,popularFeedback:[],tierSelect:{value:'all'},
    baseFeedbackVariantId:id=>String(id??'').trim().split('#')[0].split('@')[0]};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function characterById('),source.indexOf('function roleLabel('))
    + source.slice(source.indexOf('function popularFeedbackRows('),source.indexOf('function renderRankRoleFilters(')),context);
  return context;
};
const optimized=make(current);
for (const character of characterVariants) {
  assert.equal(optimized.characterById(character.variantId), character);
  assert.equal(optimized.characterById(character.characterId), characterVariants.find(v=>v.characterId===character.characterId));
}
assert.equal(optimized.characterById('unknown'),undefined);
const reasonContext={combatRangeOf,compositionMembers:row=>row.members,characterById:()=>({role:'mage',tags:[],weaponRange:'ranged'}),t:key=>key};
vm.createContext(reasonContext);
vm.runInContext(current.slice(current.indexOf('function compositionReason('),current.indexOf('function compositionDetailText(')),reasonContext);
assert.equal(reasonContext.compositionReason({members:['a','b','c'],source:'official',top3Rate:.8},true),'comp.officialObserved');
for(const tier of ['all','iron_bronze','platinum_diamond','meteor_mithril','demigod_eternity']) {
  optimized.tierSelect.value=tier;
  const actual=optimized.officialCompositionRows();
  assert.ok(actual.length<=24);
  for(const row of actual){
    const input=optimized.officialCompositionStatsByTier[optimized.officialBucketForTier(tier)];
    assert.ok(input.some(x=>x.candidate===row.candidate&&x.games===row.games&&x.teammates.join()===row.teammates.join()), 'never replace tier rows with pooled records');
  }
  assert.equal(optimized.officialCompositionRows(),actual,'unchanged tables reuse cached rows');
}
optimized.tierSelect.value='all';
const oldRows=optimized.officialCompositionRows();
optimized.officialCompositionStatsByTier={...optimized.officialCompositionStatsByTier,
  all:[{candidate:'rio:bow',teammates:['seres:two_handed_sword','lucia:sniper_rifle'],games:100,winRate:1,top3Rate:1,avgPlacement:1}]};
assert.notEqual(optimized.officialCompositionRows(),oldRows,'replaced remote tables invalidate the cache');
const start=performance.now();
for(let i=0;i<1000;i++)optimized.officialCompositionRows();
console.log(`Dashboard cache regression passed: up to 24 tier-isolated trios, remote update invalidation; 1000 warm lookups ${(performance.now()-start).toFixed(2)}ms.`);
