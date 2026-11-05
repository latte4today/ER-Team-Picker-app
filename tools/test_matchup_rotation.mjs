import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { characterVariants } from '../src/data.js';
import { tournamentBuilds } from '../src/tournamentMeta.js';
import { matchupGuidance, createMatchupRotation } from '../src/matchupGuidance.js';
const team = ids => ids.map(id => characterVariants.find(c => c.variantId === id));
const own = team(['lenox:whip','rio:bow','eva:throw']);
const resolve = row => team(row.members.map(m => m.variantId));
const rotate = createMatchupRotation(() => 0);
const next = () => matchupGuidance(own,tournamentBuilds,resolve,(reason,examples)=>rotate(reason,examples));
const pages = [next(),next(),next()];
const lineup = e => e.members.map(m=>m.variantId.split(':')[0]).sort().join('|');
const first = pages[0].find(r=>r.reason==='protectAndCounter');
const second = pages[1].find(r=>r.reason===first.reason);
assert.notDeepEqual(first.examples.map(lineup),second.examples.map(lineup),'refresh advances the observed opponent deck');
assert.equal(new Set([...first.examples,...second.examples].map(lineup)).size,6,'do not repeat until distinct alternatives have been used');
assert.deepEqual(createMatchupRotation(()=>0)('empty',[]),[]);
const tiny = createMatchupRotation(()=>0);
assert.equal(tiny('tiny',[first.examples[0]],3).length,1,'never invent alternatives for a small pool');
for(let i=0;i<30;i++) for(const row of next()) {
 assert.equal(new Set(row.examples.map(lineup)).size,row.examples.length);
 for(const e of row.examples) {
  assert.ok(tournamentBuilds.some(r=>r.members===e.members),'only observed builds');
  assert.equal(matchupGuidance(own,[{members:e.members}],resolve)[0].reason,row.reason);
 }
}
// Exercise actual rendering, caching and refresh event wiring with real references.
const app=await fs.readFile(new URL('../src/app.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('const matchupReferenceCache ='),app.indexOf('function unionSubjectName'));
const events={};
const context={ matchupGuidance,createMatchupRotation:()=>createMatchupRotation(()=>0),tournamentBuilds,
 tierSelect:{value:'all'},characterById:id=>characterVariants.find(c=>c.variantId===id),
 effectiveCombatTeam:members=>members,defaultCoreForVariant:()=>({core:'test'}),
 normalizeCoreName:core=>core,coreIconPath:()=>null,t:(key,args)=>key+JSON.stringify(args??{}),
 document:{addEventListener:(event,fn)=>{events[event]=fn;}} };
vm.createContext(context);vm.runInContext(source,context);
const a=context.renderMatchupGuidance(own);
assert.equal(context.renderMatchupGuidance([...own].reverse()),a,'incidental renders and slot ordering do not advance the page');
const key=a.match(/data-matchup-context="([^"]+)"/)[1];
const section={dataset:{matchupContext:key},outerHTML:a};
assert.ok(!a.includes('data-matchup-refresh'),'examples have no refresh button');
assert.equal(events.click,undefined);
let refreshes=0;
const panel={tagName:'DETAILS',open:true,dataset:{},querySelectorAll:()=>({forEach:fn=>{refreshes++;fn(section);}})};
events.toggle({target:panel});assert.equal(refreshes,0);
events.toggle({target:panel});assert.equal(refreshes,1,'reopening details advances examples');
assert.notEqual(section.outerHTML,a,'reopening automatically changes the shown examples');
const fresh=()=>({dataset:{lazyMatchup:context.renderLazyMatchupGuidance(own).match(/data-lazy-matchup="([^"]+)"/)[1]},querySelector:()=>({set innerHTML(value){this.result=value;fresh.last=value;}})});
context.populateLazyMatchup(fresh());const pageOne=fresh.last;
context.populateLazyMatchup(fresh());
assert.notEqual(fresh.last,pageOne,'a fresh recommendation disclosure advances automatically without a manual control');
const modalContent={};
context.document.querySelector=selector=>selector==='#dashboard-detail-title'?{}:modalContent;
context.dashboardDetailDialog={open:false,showModal(){this.open=true;}};
context.dashboardDetailOwner=null;
let automaticRefreshes=0;
context.refreshMatchupSection=()=>{automaticRefreshes++;};
vm.runInContext(app.slice(app.indexOf('function openDashboardDetails('),app.indexOf('function closeDashboardDetails(')),context);
const modalOwner={dataset:{dashboardCharacter:'rio:bow'},querySelector:()=>({textContent:'Rio'})};
const cachedBody={innerHTML:a,querySelectorAll:()=>[section]};
context.openDashboardDetails(modalOwner,cachedBody);assert.equal(automaticRefreshes,0);
context.openDashboardDetails(modalOwner,cachedBody);assert.equal(automaticRefreshes,1,'cached dashboard readers also advance on each reopening');
const rowStart=app.indexOf('  const recToggle = event.target.closest(');
vm.runInContext('function toggleRecommendation(event) {'+app.slice(rowStart,app.indexOf('  const showMoreButton =',rowStart))+'}',context);
const rowBody={hidden:true,querySelectorAll:()=>[section]};
const rowItem={querySelector:()=>rowBody,classList:{toggle(){}}};
const rowButton={closest:()=>rowItem,setAttribute(){}};
const rowEvent={target:{closest:()=>rowButton}};
context.toggleRecommendation(rowEvent);assert.equal(automaticRefreshes,2);
context.toggleRecommendation(rowEvent);assert.equal(automaticRefreshes,2,'closing does no analysis');
context.toggleRecommendation(rowEvent);assert.equal(automaticRefreshes,3,'reopening a recommendation also advances its already-open examples');
console.log('Matchup rotation: observed builds, no early repeats, small pools, stable rendering, refresh and reopen passed.');
