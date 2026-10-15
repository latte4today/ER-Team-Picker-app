import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=await fs.readFile(new URL('../src/app.js',import.meta.url),'utf8');
let onToggle;
let onInlineToggle;
const calls=[];
const coreOptions=[];
let opens=0;
const state={
  recommendations:{addEventListener:(type,handler,capture)=>{assert.equal(type,'toggle');assert.equal(capture,true);onToggle=handler;}},
  dashboardDetailDialog:{addEventListener:(type,handler,capture)=>{assert.equal(type,'toggle');assert.equal(capture,true);onInlineToggle=handler;}},
  renderDashboardCharacterDetails:id=>{calls.push(id);return '<p>Character</p>';},
  renderDashboardTeamDetails:(ids,options)=>{calls.push(ids);coreOptions.push(options);return '<p>Team</p>';},
  renderTrendDetails:ids=>{calls.push(ids);return '<p>Trend</p>';},
  openDashboardDetails:()=>{opens++;},
};
vm.createContext(state);
const start=source.indexOf('recommendations.addEventListener("toggle"');
vm.runInContext(source.slice(start,source.indexOf('recommendations.addEventListener("pointerdown"',start)),state);
const body={childElementCount:0,set innerHTML(value){this.childElementCount=1;this.content=value;}};
const card={open:false,dataset:{dashboardCharacter:'rio:bow'},querySelector:()=>body};
onToggle({target:card});assert.equal(calls.length,0,'closed cards do no analysis');
card.open=true;onToggle({target:card});assert.deepEqual(calls,['rio:bow']);
onToggle({target:card});assert.equal(calls.length,1,'reopening reuses the details without rebuilding ranking');
assert.equal(opens,2,'cached details still open the separate reader each time');
body.childElementCount=0;card.dataset={dashboardTeam:'rio:bow|seres:two_handed_sword|lucia:sniper_rifle'};
onToggle({target:card});assert.deepEqual(Array.from(calls[1]),['rio:bow','seres:two_handed_sword','lucia:sniper_rifle']);
card.dataset={};onToggle({target:card});assert.equal(calls.length,2,'nested concept disclosures do not trigger ranking analysis');
body.childElementCount=0;
card.dataset={dashboardInline:'true',dashboardTeam:'rio:bow|seres:two_handed_sword|lucia:sniper_rifle'};
onInlineToggle({target:card});
assert.equal(calls.length,3);
assert.equal(opens,3,'inline team analysis does not open another drawer');
onInlineToggle({target:card});assert.equal(calls.length,3,'inline reopen reuses the team explanation');
body.childElementCount=0;
card.dataset.dashboardCore='rio:bow#7000601';
onInlineToggle({target:card});
assert.equal(coreOptions.at(-1).coreOverrides['rio:bow'],'7000601','completion keeps the recommended trait when expanded');
body.childElementCount=0;
card.dataset={dashboardTrend:'rio:bow|seres:two_handed_sword'};
onToggle({target:card});
assert.deepEqual(Array.from(calls.at(-1)),['rio:bow','seres:two_handed_sword'],'duo trends open the completion reader');
let focused=false,closed=false;
const owner={open:true,querySelector:()=>({focus:options=>{focused=options.preventScroll;}})};
state.dashboardDetailOwner=owner;
state.dashboardDetailDialog={close:()=>{closed=true;}};
vm.runInContext(source.slice(source.indexOf('function closeDashboardDetails('),source.indexOf("document.querySelector('#dashboard-detail-close').addEventListener")),state);
state.closeDashboardDetails();
assert.ok(closed&&focused&&!owner.open);
assert.equal(state.dashboardDetailOwner,null,'close restores the originating card and focus without scrolling');
state.dashboardDetailDialog.getBoundingClientRect=()=>({left:680,right:1366,top:0,bottom:768});
vm.runInContext(source.slice(source.indexOf('function isDashboardBackdrop('),source.indexOf("dashboardDetailDialog.addEventListener('pointerdown'")),state);
assert.ok(state.isDashboardBackdrop({target:state.dashboardDetailDialog,clientX:300,clientY:200}));
assert.ok(!state.isDashboardBackdrop({target:state.dashboardDetailDialog,clientX:900,clientY:200}),
  'blank space inside the panel is not the backdrop');
assert.ok(!state.isDashboardBackdrop({target:{},clientX:900,clientY:200}));
let switchPage;
state.dashboardDetailDialog={addEventListener:(_,handler)=>{switchPage=handler;}};
const pageHandlerStart=source.indexOf("dashboardDetailDialog.addEventListener('click'",source.indexOf('function renderDetailPages('));
vm.runInContext(source.slice(pageHandlerStart,source.indexOf('function renderDashboardTeamDetails(',pageHandlerStart)),state);
const tabs=Array.from({length:4},(_,index)=>({dataset:{detailPage:String(index)},setAttribute:(_,value)=>{tabs[index].pressed=value;}}));
const panels=Array.from({length:4},(_,index)=>({dataset:{detailPanel:String(index)},hidden:index!==0}));
const pages={querySelectorAll:selector=>selector.includes('button')?tabs:panels};
tabs[2].closest=()=>pages;
switchPage({target:{closest:()=>tabs[2]}});
assert.deepEqual(panels.map(panel=>panel.hidden),[true,true,false,true]);
assert.deepEqual(tabs.map(tab=>tab.pressed),['false','false','true','false']);
tabs[3].closest=()=>pages;
switchPage({target:{closest:()=>tabs[3]}});
assert.deepEqual(panels.map(panel=>panel.hidden),[true,true,true,false]);
const languageStorage=new Map();
globalThis.localStorage={getItem:key=>languageStorage.get(key)??null,setItem:(key,value)=>languageStorage.set(key,value)};globalThis.document={documentElement:{}};
const {setLanguage,t}=await import('../src/i18n/index.js');
for(const lang of ['ko','en','ja','zhHans','zhHant']){
  setLanguage(lang);
  for(const key of ['rank.characterDetails','rank.teamDetails','rank.coreTitle','rank.memberRoles',
    'rank.coreComparison','rank.coreName','rank.observedTeams','rank.noObservedTeams',
    'detail.overview','detail.cores','detail.teams','detail.plan','detail.roles','detail.matchups',
    'detail.synergies','rank.synergyBasis','rank.synergyPositive','rank.synergyNegative',
    'rank.synergyImprovement','rank.synergyDecline','rank.synergySamples','rank.noSynergy',
    'trend.title','trend.period','trend.size1','trend.size2','trend.size3','trend.rising',
    'trend.share','trend.results','trend.complete','trend.empty','trend.stale'])assert.notEqual(t(key),key);
}
console.log('Dashboard detail regression passed: lazy open, exact weapon variants, cached reopen, nested disclosure isolation and five locales.');
