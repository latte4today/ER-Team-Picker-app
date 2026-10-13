import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { loadRosterPresets, saveRosterPresets, sharedPresetStorageKey, escapePresetName } from '../src/rosterPresets.js';
const draftKey='er-team-picker-playable-presets', unionKey='er-team-picker-union-presets';
const values=new Map([
  [draftKey,JSON.stringify([{name:'Rank',variants:['rio:bow','luke:bat']},{name:'Rank 2',variants:['sho:spear']},{name:'All',variants:[]}])],
  [unionKey,JSON.stringify({0:[{name:'Rank',variants:['luke:bat','rio:bow','rio:bow']}],1:[{name:'Rank',variants:['seres:two_handed_sword']}],2:[{name:'Union',variants:['lucia:sniper_rifle']}],3:[]})],
]);
const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
const originals=[values.get(draftKey),values.get(unionKey)];
const presets=loadRosterPresets(storage,['rio:bow','luke:bat','sho:spear']);
assert.deepEqual(presets.map(p=>p.name),['Rank','Rank 2','All','Rank 3','Union']);
assert.deepEqual(presets.find(p=>p.name==='Rank 3').variants,['seres:two_handed_sword']);
assert.deepEqual(presets.find(p=>p.name==='All').variants,['rio:bow','luke:bat','sho:spear'],
  'legacy unrestricted setup presets load as all variants in Union, not an empty roster');
assert.deepEqual([values.get(draftKey),values.get(unionKey)],originals,'preserve original migration backups');
assert.deepEqual(loadRosterPresets(storage),presets,'migration is idempotent');
presets.push({name:'New Union',variants:['rio:bow']});
saveRosterPresets(storage,presets);
assert.deepEqual(loadRosterPresets(storage),presets,'saved shared list survives reload');
saveRosterPresets(storage,[]);
assert.deepEqual(loadRosterPresets(storage),[],'deleting shared presets does not resurrect legacy entries');
assert.equal(escapePresetName('<img src="x">&'), '&lt;img src=&quot;x&quot;&gt;&amp;');
values.set(sharedPresetStorageKey,'malformed');
values.set(draftKey,'malformed');
assert.deepEqual(loadRosterPresets(storage).map(p=>p.name),['Rank','Rank 2','Union'],
  'malformed source does not prevent recovery from valid Union data');
const app=await fs.readFile(new URL('../src/app.js',import.meta.url),'utf8');
let click;
const message={textContent:''};
const state={
  unionPresetPanel:{addEventListener:(_,handler)=>{click=handler;},querySelector:()=>message},
  unionPresets:[{name:'Large',variants:Array.from({length:16},(_,i)=>`c${i}:bow`)}],
  unionRosters:[new Set(['original:bow']),new Set(['other:bow'])],
  activeUnionPlayer:0,_unionPresetSaveTimer:null,clearTimeout:()=>{},t:key=>key,
  saveUnionRosters:()=>{},renderUnionCharacters:()=>{},renderUnionPlayers:()=>{},closeUnionPresetDropdown:()=>{},
};
vm.createContext(state);
const handlerStart=app.indexOf('unionPresetPanel.addEventListener("click"');
vm.runInContext(app.slice(handlerStart,app.indexOf('unionRoleFilters.addEventListener("click"',handlerStart)),state);
const row={dataset:{presetPlayer:'0'},querySelector:()=>({dataset:{selectedIndex:'0'}})};
const event={target:{closest:selector=>selector==='[data-preset-player]'?row:selector==='.union-preset-load-btn'?{}:null}};
click(event);
assert.deepEqual([...state.unionRosters[0]],['original:bow'],'oversized shared preset cannot replace the roster');
assert.equal(message.textContent,'union.presetTooLarge');
state.unionPresets[0].variants=['rio:bow','luke:bat'];
click(event);
assert.deepEqual([...state.unionRosters[0]],['rio:bow','luke:bat']);
assert.deepEqual([...state.unionRosters[1]],['other:bow'],'loading changes only the requested player');
console.log('Shared presets passed: legacy object migration, same-name collision, unordered deduplication, unrestricted setup, backups, reload and deletion persistence.');
