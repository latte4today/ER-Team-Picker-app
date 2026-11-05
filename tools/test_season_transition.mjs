import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {seasonFromPage} from './season_metadata.mjs';
import {currentSeason,validSeasonState,setSeasonState,isCurrentSeason,isCurrentRecent,canComparePreviousPatch} from '../src/seasonContext.js';
import {recentMetaSnapshot,recentEvidence,recentMetaVersion,setRecentMeta,recentStrengthCorrection} from '../src/recentMeta.js';
import {characterVariants} from '../src/data.js';
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
globalThis.document={documentElement:{lang:'ko',dataset:{}}};
const {recommend,evaluateCandidate,updateOfficialStats}=await import('../src/recommender.js');
const old=structuredClone(currentSeason());
assert.ok(validSeasonState(old));
const now=Date.now();
// Test policy relative to the real phase so this also runs after future switches.
const next={...old,generatedAt:new Date(now+1).toISOString(),seasonId:old.seasonId+1,
  seasonKey:'PRE_SEASON_99',phase:'preseason',displaySeason:old.displaySeason+1,
  patch:(old.displaySeason+1)*1000,phaseStartedAt:new Date(now).toISOString()};
const v=recentMetaVersion();
assert.ok(setSeasonState(next));
assert.notEqual(recentMetaVersion(),v,'phase version invalidates all dependent recommendation and dashboard caches');
assert.equal(isCurrentSeason({currentSeason:old.seasonId}),false);
assert.equal(recentEvidence(characterVariants[0].variantId,'all'),null,'previous-phase aggregates cannot be reused as new-phase performance');
assert.equal(setSeasonState(old),false,'no phase rollback');
assert.equal(setSeasonState({...next,generatedAt:new Date(now+2).toISOString(),patch:next.patch-1}),false,'no patch rollback');
assert.equal(validSeasonState({...next,phase:'ranked'}),false);
const c={patch:next.patch,days:7,updatedAt:new Date(now+8*86400000).toISOString()};
const fresh={seasonId:next.seasonId,seasonKey:next.seasonKey,phase:next.phase};
assert.ok(isCurrentRecent(fresh,c));
assert.equal(isCurrentRecent(fresh,{...c,updatedAt:new Date(now+86400000).toISOString()}),false,'withhold rolling windows crossing preseason start');
assert.equal(isCurrentRecent(fresh,{...c,patch:old.patch}),false,'never relabel a lagging patch with the new season');
assert.equal(canComparePreviousPatch({patch:old.patch},c),false);
assert.equal(canComparePreviousPatch({patch:next.patch-10},c),false);
assert.ok(canComparePreviousPatch({patch:next.patch},{...c,updatedAt:new Date(now+15*86400000).toISOString()}));
// Actual recommendation path must remain usable without any new outcome rows.
const recommendations=recommend(['rio:bow','lenox:whip'],'all');
assert.ok(recommendations.length>0&&recommendations.every(r=>Number.isFinite(r.total)));
const id=characterVariants[0].variantId;
const before=evaluateCandidate(['rio:bow','lenox:whip'],id,'all').total;
updateOfficialStats({source:{currentSeason:old.seasonId},officialCandidateStatsByTier:{all:{[id]:{games:100000,top3Rate:1,winRate:1,avgPlacement:1}}}});
assert.equal(evaluateCandidate(['rio:bow','lenox:whip'],id,'all').total,before,'old-season outcomes cannot drive the new-season individual score');
// Collector accepts the phase switch before its statistics catch up.
const page={isPreSeason:true,dehydratedState:{queries:[
  {queryKey:['GET_SEASONS_KEY'],state:{data:{seasons:[{id:next.seasonId,key:next.seasonKey,name:`프리시즌 ${next.displaySeason}`,isCurrent:true}]}}},
  {queryKey:['getCharacterStatistics'],state:{data:{meta:{patch:old.patch}}}}
]}};
assert.equal(seasonFromPage(page,old,new Date(now).toISOString()).seasonId,next.seasonId);
assert.throws(()=>seasonFromPage({...page,isPreSeason:false},old));
page.dehydratedState.queries[0].state.data.seasons.push({...page.dehydratedState.queries[0].state.data.seasons[0]});
assert.throws(()=>seasonFromPage(page,old));
// Exercise the actual renderer's ranking function with current-phase outcomes.
// Only outcomes change; popularity and all other signals remain constant.
const realNow=Date.now;
try {
  Date.now=()=>now+8*86400000;
  const freshSnapshot=structuredClone(recentMetaSnapshot());
  Object.assign(freshSnapshot,fresh,{generatedAt:new Date(Date.now()).toISOString()});
  for(const cohort of Object.values(freshSnapshot.cohorts)) {
    cohort.patch=next.patch;cohort.updatedAt=freshSnapshot.generatedAt;
  }
  assert.ok(setRecentMeta(freshSnapshot));
  assert.ok(recentEvidence(id,'all'));
  const source=await fs.readFile(new URL('../src/app.js',import.meta.url),'utf8');
  const context={characterVariants,isCurrentSeason,currentSeason,recentEvidence,recentStrengthCorrection,
    officialStatsSource:{currentSeason:old.seasonId},tierSelect:{value:'all'},rankTierByPercentile:()=> 'B'};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function rankerCharacterRows('),source.indexOf('function renderRankRoleFilters(')),context);
  const score=()=>context.rankerCharacterRows().find(r=>r.characterId===id).score;
  const first=score();
  const changed=structuredClone(freshSnapshot);changed.generatedAt=new Date(Date.now()+1).toISOString();
  const row=changed.cohorts.diamond_plus.rows[id];row.wins=row.games;row.top3=row.games;row.placement=row.games;
  assert.ok(setRecentMeta(changed));assert.ok(score()>first,'new outcomes reach the displayed ranking score');
  const second=score();
  changed.generatedAt=new Date(Date.now()+2).toISOString();row.pickShare=.5;
  assert.ok(setRecentMeta(changed));assert.equal(score(),second,'popularity alone does not increase ranking');
  const regular={...next,generatedAt:new Date(Date.now()+3).toISOString(),seasonId:next.seasonId+1,
    seasonKey:'SEASON_99',phase:'ranked',phaseStartedAt:new Date(Date.now()).toISOString()};
  assert.ok(setSeasonState(regular));
  assert.equal(recentEvidence(id,'all'),null,'preseason results cannot leak into the following regular season');
  assert.equal(context.rankerCharacterRows().length,0,'a new phase never displays previous-phase ranks');
} finally {Date.now=realNow;}
for(const lang of ['ko','en','ja','zhHans','zhHant']) {
  const dictionary=(await import(`../src/i18n/${lang}.js`))[lang];
  assert.ok(dictionary['season.warming']&&dictionary['season.preseason']);
}
console.log('Season transition passed: phase/patch rollback rejection, stale outcomes withheld, boundary windows blocked, cache invalidation and usable cold-start recommendations.');
