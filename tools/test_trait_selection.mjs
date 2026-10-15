import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=await fs.readFile(new URL('../src/app.js',import.meta.url),'utf8');
let focused=false,scheduled=0,refreshed=0;
const scope={querySelector:()=>({focus:()=>{focused=true;}})};
const state={slotCores:[null,null,null],slotAssignments:['luke:bat','rio:bow',null],tierSelect:{value:'all'},
  topCoresForVariant:()=>[{core:'7200301'},{core:'7100501'}],
  matchFeedback:scope,detectedTeam:scope,completeWalkthroughAction:()=>{},
  renderDetectedTeam:()=>{refreshed++;},renderMatchFeedback:()=>{refreshed++;},scheduleRenderRecommendations:()=>{scheduled++;}};
vm.createContext(state);
vm.runInContext(source.slice(source.indexOf('function selectSlotCoreButton('),source.indexOf('detectedTeam.addEventListener')),state);
vm.runInContext(source.slice(source.indexOf('function selectedCoresMap('),source.indexOf('function coreInfoForSlot(')),state);
state.selectSlotCoreButton({dataset:{coreSlot:'0',core:'7100501'},closest:()=>scope});
assert.equal(state.selectedCoresMap()['luke:bat'],'7100501','self trait feeds recommendation map, not a rating-only override');
assert.equal(scheduled,1);assert.equal(refreshed,2);assert.ok(focused);
state.selectSlotCoreButton({dataset:{coreSlot:'1',core:'invalid'},closest:()=>scope});
assert.equal(state.slotCores[1],null,'reject forged or obsolete trait');
state.selectSlotCoreButton({dataset:{coreSlot:'2',core:'7100501'},closest:()=>scope});
assert.equal(state.slotCores[2],null,'empty slots cannot acquire a trait');
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};globalThis.document={documentElement:{dataset:{}}};
const {evaluateCandidate,effectiveCombatTeam}=await import('../src/recommender.js');
const {characterVariants}=await import('../src/data.js');
const luke=characterVariants.find(c=>c.variantId==='luke:bat');
const healing={'luke:bat':'7200301'},damage={'luke:bat':'7100501'};
assert.equal(effectiveCombatTeam([luke],healing)[0].effectiveCore.core,'7200301');
assert.equal(effectiveCombatTeam([luke],damage)[0].effectiveCore.core,'7100501');
assert.notDeepEqual(effectiveCombatTeam([luke],healing)[0].tags,effectiveCombatTeam([luke],damage)[0].tags);
const first=evaluateCandidate(['rio:bow','seres:two_handed_sword'],'luke:bat','all',{},[],healing);
const second=evaluateCandidate(['rio:bow','seres:two_handed_sword'],'luke:bat','all',{},[],damage);
assert.notEqual(first.total,second.total,'real scoring must reflect the chosen trait');
console.log('Trait selection: shared self/team state, score and role effects, invalid/empty rejection, refresh and keyboard focus passed.');
