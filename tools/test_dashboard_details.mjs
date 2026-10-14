import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=await fs.readFile(new URL('../src/app.js',import.meta.url),'utf8');
let onToggle;
const calls=[];
let opens=0;
const state={
  recommendations:{addEventListener:(type,handler,capture)=>{assert.equal(type,'toggle');assert.equal(capture,true);onToggle=handler;}},
  renderDashboardCharacterDetails:id=>{calls.push(id);return '<p>Character</p>';},
  renderDashboardTeamDetails:ids=>{calls.push(ids);return '<p>Team</p>';},
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
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};globalThis.document={documentElement:{}};
const {setLanguage,t}=await import('../src/i18n/index.js');
for(const lang of ['ko','en','ja','zhHans','zhHant']){
  setLanguage(lang);
  for(const key of ['rank.characterDetails','rank.teamDetails','rank.coreTitle','rank.memberRoles',
    'rank.coreComparison','rank.coreName','rank.observedTeams','rank.noObservedTeams'])assert.notEqual(t(key),key);
}
console.log('Dashboard detail regression passed: lazy open, exact weapon variants, cached reopen, nested disclosure isolation and five locales.');
