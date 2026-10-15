import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {hasFullRankedBaseline} from '../src/characterAvailability.js';
import {metaMovementRows,movementBar} from '../src/metaMovement.js';
const source=await fs.readFile(new URL('../src/app.js',import.meta.url),'utf8');
const now=new Date().toISOString();
const state={hasFullRankedBaseline,metaMovementRows,movementBar,getLanguage:()=> 'ko',tierSelect:{value:'all'},officialStatsVersion:1,activeRankRole:'all',activeTrendSize:2,
  metaTrends:{generatedAt:now,latestMatchAt:now,recentStart:now,end:now,byTier:{all:{rows:[
    {members:['new:a','new:b'],delta:.01,ratio:2,previousShare:.01,recentShare:.02,games:100,top3Rate:.4},
    {members:['fall:a','fall:b'],delta:-.02,ratio:.5,previousShare:.04,recentShare:.02,games:100,top3Rate:.4},
  ]}}},dataSignature:()=>'',popularFeedback:[],tournamentStatsVersion:1,remoteFeedback:{},currentRelationshipRows:()=>[],
  dashboardRenderKey:'',recommendations:{querySelector:()=>null,innerHTML:''},officialBucketForTier:()=> 'all',
  officialCompositionRows:()=>[{candidate:'old:c',teammates:['old:a','old:b'],games:1000,source:'official'}],
  compositionMembers:row=>[...row.teammates,row.candidate],characterById:()=>({}),
  renderCharacterFace:id=>`<span>${id}</span>`,compositionDetailText:row=>`${row.games} official games`,
  compositionReason:row=>{assert.equal(row.source,'official');return 'Cumulative';},
  rankerCharacterRows:()=>[],t:key=>key,renderRankRoleFilters:()=>'',
  combinedCompositionRows:()=>{throw new Error('User recommendation ranking must not replace either section');}};
vm.createContext(state);
vm.runInContext(source.slice(source.indexOf('function renderHomeDashboard('),source.indexOf('function fullTeamRecommendationKey(')),state);
state.renderHomeDashboard();
assert.match(state.recommendations.innerHTML,/overall-compositions/);
assert.match(state.recommendations.innerHTML,/1000 official games/);
assert.match(state.recommendations.innerHTML,/old:a/);
assert.match(state.recommendations.innerHTML,/new:a/);
assert.match(state.recommendations.innerHTML,/fall:a/);
assert.match(state.recommendations.innerHTML,/trend-chart-axis/);
assert.match(state.recommendations.innerHTML,/rank-section/);
state.metaTrends.byTier.all.rows=[];
state.renderHomeDashboard();
assert.match(state.recommendations.innerHTML,/1000 official games/,'cumulative teams stay visible when no current rise is found');
assert.match(state.recommendations.innerHTML,/trend.empty/);
state.metaTrends.previousStart='2026-09-30T15:00:00Z';
state.metaTrends.byTier.all.rows=[{members:['seres:two_handed_sword','old:a'],delta:.1,ratio:10,previousShare:0,recentShare:.1,games:1000,top3Rate:.4}];
state.renderHomeDashboard();
assert.ok(!state.recommendations.innerHTML.includes('data-dashboard-trend="seres:'),'client also blocks legacy summaries with an incomplete new-character baseline');
assert.match(state.recommendations.innerHTML,/1000 official games/);
console.log('Ranking sections: cumulative official teams, rising duos and character ranking coexist; no user-vote replacement or empty-trend disappearance.');
