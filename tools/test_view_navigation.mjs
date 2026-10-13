import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createViewScheduler } from '../src/viewScheduler.js';
const app=(await fs.readFile(new URL('../src/app.js',import.meta.url),'utf8')).replaceAll('\r\n','\n');
const frames=[],tasks=[],events=[];
const scheduler=createViewScheduler({requestFrame:cb=>frames.push(cb),scheduleTask:cb=>tasks.push(cb)});
const buttons=['setup','recommendations','union'].map(view=>({dataset:{view},addEventListener:(event,cb)=>{buttons.find(b=>b.dataset.view===view).click=cb;}}));
const state={sideTabs:buttons,activeView:'setup',navigationRenderer:scheduler,
  renderViewChrome:()=>events.push('chrome:'+state.activeView),render:()=>events.push('content:'+state.activeView)};
vm.createContext(state);
const start=app.indexOf('sideTabs.forEach((button) => {\n  button.addEventListener');
vm.runInContext(app.slice(start,app.indexOf('settingsOpenButton.addEventListener',start)),state);
buttons[1].click();
assert.deepEqual(events,['chrome:recommendations'],'click switches the visible view before content work');
buttons[2].click(); buttons[0].click();
frames.splice(0).forEach(cb=>cb());
assert.ok(events.every(x=>x.startsWith('chrome:')),'content waits beyond the animation frame');
tasks.splice(0).forEach(cb=>cb());
assert.equal(events.filter(x=>x.startsWith('content:')).length,1);
assert.equal(events.at(-1),'content:setup','rapid clicks cannot render a superseded view');

const calls=[];
const renderState={activeView:'setup',navigationRenderer:{cancel(){}},translatedLanguage:'ko',
  getLanguage:()=> 'ko',applyTranslations:()=>calls.push('translations'),renderViewChrome:()=>calls.push('chrome'),
  selectedCount:{},unionParticipatingPlayers:new Set([0,1,2])};
for(const name of ['renderRoleFilters','renderCharacters','renderPlayableTools','renderSelectedTeam',
  'renderMatchFeedback','renderRecommendations','renderManualSlots','renderUnion','ensureUnionPresetPanel',
  'updateUnionCalculateButton','refreshRemoteFeedbackIfNeeded','refreshPopularFeedback','scheduleWalkthroughRefresh']) {
  renderState[name]=()=>calls.push(name);
}
vm.createContext(renderState);
vm.runInContext(app.slice(app.indexOf('function render() {'),app.indexOf('function renderManualSlots(')),renderState);
for(const view of ['setup','recommendations','union']) {
  renderState.activeView=view;calls.length=0;renderState.render();
  if(view==='union') assert.ok(!calls.includes('renderRecommendations')&&!calls.includes('renderCharacters'));
  if(view==='recommendations') assert.ok(!calls.includes('renderCharacters')&&!calls.includes('renderMatchFeedback'));
  if(view==='setup') assert.ok(calls.includes('renderRecommendations')&&!calls.includes('renderUnion'));
  assert.ok(!calls.includes('translations'),'unchanged language does not rewrite static labels');
}
console.log('Navigation regression passed: immediate chrome, post-paint content, latest click wins, hidden views are not rendered.');
