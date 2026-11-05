import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import { characterVariants } from '../src/data.js';
import { OFFICIAL_MATCH_SOURCE, officialCandidateStatsByTier } from '../src/officialMatchStats.js';
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
globalThis.document={documentElement:{lang:'ko',dataset:{}}};
const {recommend}=await import('../src/recommender.js');
const tiers=['all','iron_gold','platinum_diamond','meteor_mithril','demigod_eternity'];
const selected=['lenox:whip','rio:bow'];
const report={source:OFFICIAL_MATCH_SOURCE,tiers:[],search:[]};
for(const tier of tiers){
 const rows=recommend(selected,tier);
 assert.ok(rows.length);
 assert.ok(rows.every(r=>Number.isFinite(r.total)&&Number.isFinite(r.score)));
 assert.ok(rows.every(r=>!selected.includes(r.character.variantId)));
 const reverse=recommend([...selected].reverse(),tier);
 assert.deepEqual(rows.map(r=>[r.character.variantId,r.recommendedCore?.core,r.total]),reverse.map(r=>[r.character.variantId,r.recommendedCore?.core,r.total]));
 const restricted=recommend(selected,tier,{},['eva:throw','rozzi:pistol']);
 assert.ok(restricted.length&&restricted.every(r=>['eva:throw','rozzi:pistol'].includes(r.character.variantId)));
 const covered=characterVariants.filter(c=>(officialCandidateStatsByTier[tier]?.[c.variantId]?.games??0)>0).length;
 report.tiers.push({tier,covered,totalVariants:characterVariants.length,uniqueCandidates:new Set(rows.map(r=>r.character.variantId)).size});
}
const app=await fs.readFile(new URL('../src/app.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('function fullTeamRecommendationKey('),app.indexOf('function _renderFullTeamCards('));
const previous=execFileSync('git',['show','e86972e:src/app.js'],{encoding:'utf8',maxBuffer:2000000});
const previousSource=previous.slice(previous.indexOf('function fullTeamRecommendationKey('),previous.indexOf('function _renderFullTeamCards('));
for(const anchorId of ['lenox:whip','rio:bow','eva:throw']){
 const ctx={chosenPickId:anchorId,tierSelect:{value:'all'},playableVariantIds:new Set(),officialStatsVersion:'test',tournamentStatsVersion:'test',remoteFeedback:{},_fullTeamState:{status:'idle'},getLanguage:()=> 'ko',selectedCoresMap:()=>({}),currentRelationshipRows:()=>[],dataSignature:JSON.stringify,_renderFullTeamCards:()=>{},yieldToUi:async()=>{},recommend};
 vm.createContext(ctx);vm.runInContext(source,ctx);await ctx.renderFullTeamRecommendations();
 const pairs=ctx._fullTeamState.compositions;
 assert.ok(pairs.length);
 assert.ok(pairs.every(p=>Number.isFinite(p.combinedRank)));
 const baseline={...ctx,_fullTeamState:{status:'idle'}};
 vm.createContext(baseline);vm.runInContext(previousSource,baseline);await baseline.renderFullTeamRecommendations();
 report.search.push({anchorId,previousCompositions:baseline._fullTeamState.compositions.length,compositions:pairs.length,top:pairs.slice(0,3).map(p=>({members:[p.teammate1.character.variantId,p.teammate2.character.variantId],score:p.combinedRank}))});
}
console.log(JSON.stringify(report,null,2));
