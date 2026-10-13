import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
globalThis.localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
globalThis.document={documentElement:{lang:'ko',dataset:{}}};
const {characterVariants}=await import('../src/data.js');
const meta=await import('../src/metaData.js');
const official=await import('../src/officialMatchStats.js');
const current=await fs.readFile(new URL('../src/app.js',import.meta.url),'utf8');
// Frozen reference implementation: full stable sort before the optimization.
const legacyCompositionRows = 'function officialCompositionRows() {\n  const bucket = officialBucketForTier(tierSelect.value);\n  const sourceRows = [\n    ...(officialCompositionStatsByTier?.[bucket] ?? []),\n    ...(bucket === "all" ? [] : officialCompositionStatsByTier?.all ?? []),\n  ];\n\n  const rows = new Map();\n  sourceRows.forEach((row) => {\n    if (!row?.candidate || !row?.teammates?.length) return;\n    const teamKey = [...row.teammates].sort().join("+");\n    const key = compositionCanonicalKey({ teamKey, candidateId: row.candidate });\n    if (!key) return;\n    const previous = rows.get(key);\n    if (!previous || (row.games ?? 0) > (previous.games ?? 0)) {\n      rows.set(key, {\n        ...row,\n        teamKey,\n        candidateId: row.candidate,\n        source: "official",\n      });\n    }\n  });\n\n  return [...rows.values()]\n    .map((row) => {\n      const confidence = rankingConfidence(row.games ?? 0, 80);\n      return {\n        ...row,\n        score: placementRankingScore(row) * confidence + Math.min(14, (row.games ?? 0) * 0.35),\n      };\n    })\n    .sort((a, b) => b.score - a.score)\n    .slice(0, 16);\n}\n\n';
const make = source => {
  const context={characterVariants,...meta,...official,popularFeedback:[],tierSelect:{value:'all'},
    baseFeedbackVariantId:id=>String(id??'').trim().split('#')[0].split('@')[0]};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function characterById('),source.indexOf('function roleLabel('))
    + source.slice(source.indexOf('function popularFeedbackRows('),source.indexOf('function renderRankRoleFilters(')),context);
  return context;
};
const legacy=make(current),optimized=make(current);
vm.runInContext(legacyCompositionRows,legacy);
for (const character of characterVariants) {
  assert.equal(optimized.characterById(character.variantId), character);
  assert.equal(optimized.characterById(character.characterId), characterVariants.find(v=>v.characterId===character.characterId));
}
assert.equal(optimized.characterById('unknown'),undefined);
const reasonContext={compositionMembers:row=>row.members,characterById:()=>({role:'mage',tags:[],weaponRange:'ranged'}),t:key=>key};
vm.createContext(reasonContext);
vm.runInContext(current.slice(current.indexOf('function compositionReason('),current.indexOf('function compositionDetailText(')),reasonContext);
assert.equal(reasonContext.compositionReason({members:['a','b','c'],source:'official',top3Rate:.8},true),'comp.officialObserved');
for(const tier of ['all','iron_bronze','platinum_diamond','meteor_mithril','demigod_eternity']) {
  legacy.tierSelect.value=tier;optimized.tierSelect.value=tier;
  const expected=legacy.officialCompositionRows();
  const actual=optimized.officialCompositionRows();
  assert.deepEqual(JSON.parse(JSON.stringify(actual)),JSON.parse(JSON.stringify(expected)),
    'top combinations and tie ordering are unchanged for '+tier);
  assert.equal(optimized.officialCompositionRows(),actual,'unchanged tables reuse cached rows');
}
optimized.tierSelect.value='all';
const oldRows=optimized.officialCompositionRows();
optimized.officialCompositionStatsByTier={...optimized.officialCompositionStatsByTier,
  all:[{candidate:'rio:bow',teammates:['seres:two_handed_sword','lucia:sniper_rifle'],games:100,winRate:1,top3Rate:1,avgPlacement:1}]};
assert.notEqual(optimized.officialCompositionRows(),oldRows,'replaced remote tables invalidate the cache');
const start=performance.now();
for(let i=0;i<1000;i++)optimized.officialCompositionRows();
console.log(`Dashboard cache regression passed: identical top-16 in 5 tiers, remote update invalidation; 1000 warm lookups ${(performance.now()-start).toFixed(2)}ms.`);
