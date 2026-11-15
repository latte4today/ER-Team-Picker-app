import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {rankBaseline,calibratedRankScore,isValidRankStat} from '../src/rankQuality.js';
import {characterVariants} from '../src/data.js';
import {recentCohort,recentMovers,META_RANK_LIMIT} from '../src/recentMeta.js';
import {renderRecentDashboard} from '../src/recentMetaView.js';

globalThis.localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
globalThis.document={documentElement:{lang:'ko',dataset:{}}};
const {recommend,evaluateCandidate}=await import('../src/recommender.js');
const drafts=recommend(['lenox:whip','rio:bow'],'all',{},undefined,[],{}, {limit:12});
const first=drafts.slice(0,12);
assert.equal(new Set(first.map(r=>r.character.characterId)).size,12,'cores and weapons cannot occupy different primary ranks');
for(const row of drafts.slice(12))assert.ok(first.some(r=>r.character.variantId===row.character.variantId));
assert.ok(first.every(r=>r.reasons.length>0));
const limited=recommend(['lenox:whip'],'all',{},['rio','nia:pistol'],[],{}, {limit:3,includeAlternates:false,includeReasons:false});
assert.deepEqual(new Set(limited.map(r=>r.character.variantId)),new Set(['rio:bow','nia:pistol']));
assert.ok(limited.every(r=>r.reasons.length===0));
const sig=rows=>rows.map(r=>[r.character.variantId,r.recommendedCore?.core,r.total]);
const options={limit:6,includeAlternates:false};
assert.deepEqual(sig(recommend(['aya:pistol','aya:assault_rifle','unknown'],'all',{},undefined,[],{},options)),
  sig(recommend(['aya:pistol'],'all',{},undefined,[],{},options)),'duplicate selected characters cannot change team fit');
assert.equal(evaluateCandidate(['aya:pistol'],'aya:assault_rifle'),undefined,'do not evaluate the same character twice');

const field={games:20000,winRate:.12,top3Rate:.4,avgPlacement:4.5};
const prior=rankBaseline([field]);
const fluke={games:3,winRate:1,top3Rate:1,avgPlacement:1};
const established={games:1200,winRate:.14,top3Rate:.44,avgPlacement:4.3};
assert.ok(calibratedRankScore(established,prior)>calibratedRankScore(fluke,prior));
assert.equal(calibratedRankScore({...field,games:120},prior),calibratedRankScore(field,prior),'popularity alone is not merit');
assert.equal(isValidRankStat({...field,winRate:.5}),false);

const app=await fs.readFile(new URL('../src/app.js',import.meta.url),'utf8');
const ids=['luke:bat','ria:bow','nia:pistol','lenox:whip','rio:bow','aya:pistol','aya:assault_rifle'];
const context={characterVariants:characterVariants.filter(c=>ids.includes(c.variantId)),tierSelect:{value:'all'},
  currentSeason:()=>({phase:'ranked',seasonKey:'TEST'}),isCurrentSeason:()=>true,officialStatsSource:{},
  officialBucketForTier:()=> 'all',popularFeedback:[],rankerCandidateStats:{},DAK_META_SOURCE:{},
  characterRolesById:id=>[id.startsWith('aya')?'A':'B'],characterFeedbackRows:()=>new Map(),
  officialCandidateStatsByTier:{all:{'luke:bat':fluke,'nia:pistol':established,'lenox:whip':field,
    'rio:bow':{...field,avgPlacement:4.2},'aya:pistol':{...field,top3Rate:.45},
    'aya:assault_rifle':{...field,winRate:.13}}},recentMetaVersion:()=> '1',recentStrengthCorrection:()=>0,
  rankBaseline,calibratedRankScore,isValidRankStat,rankingVoteBonus:()=>0,rankTierByPercentile:(i)=>i};
vm.createContext(context);
vm.runInContext(app.slice(app.indexOf('function rankerCharacterRows('),app.indexOf('function renderRankRoleFilters(')),context);
const all=context.rankerCharacterRows();
assert.equal(context.rankerCharacterRows(),all,'repeated reads reuse sorted rows');
for(const row of context.rankerCharacterRows('A'))assert.equal(row.tierLabel,all.find(r=>r.characterId===row.characterId).tierLabel);
context.officialCandidateStatsByTier.all={...context.officialCandidateStatsByTier.all};
assert.notEqual(context.rankerCharacterRows(),all,'replacement statistics invalidate the rank cache');

const cohort=recentCohort('all'), resolve=id=>characterVariants.find(c=>c.variantId===id);
if(cohort.freshness&&cohort.pulse){
  const html=renderRecentDashboard('all',resolve,key=>key);
  assert.ok(recentMovers('all','usage').length>3&&recentMovers('all','usage').length<=META_RANK_LIMIT);
  assert.match(html,/<span class="meta-rank">4<\/span>/,'show more than the former first three recent ranks');
}
console.log('Ranking quality: distinct candidates, correct roster IDs, bounded shortlisting, stable role badges, sample shrinkage and expanded meta list.');
