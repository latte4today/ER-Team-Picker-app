import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=await fs.readFile(new URL('../src/app.js',import.meta.url),'utf8');
const now=new Date().toISOString();
const state={getLanguage:()=> 'ko',tierSelect:{value:'all'},officialStatsVersion:1,activeRankRole:'all',activeTrendSize:2,
  metaTrends:{generatedAt:now,latestMatchAt:now,recentStart:now,end:now,byTier:{all:{rows:[
    {members:['new:a','new:b'],ratio:2,previousShare:.01,recentShare:.02,games:100,top3Rate:.4},
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
assert.match(state.recommendations.innerHTML,/rank-section/);
state.metaTrends.byTier.all.rows=[];
state.renderHomeDashboard();
assert.match(state.recommendations.innerHTML,/1000 official games/,'cumulative teams stay visible when no current rise is found');
assert.match(state.recommendations.innerHTML,/trend.empty/);
console.log('Ranking sections: cumulative official teams, rising duos and character ranking coexist; no user-vote replacement or empty-trend disappearance.');
