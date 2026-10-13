import assert from 'node:assert/strict';
import { encounterStats } from './encounter_stats.mjs';
import { normalizeGame } from './official_collect_utils.mjs';
const input = {characterNum:91,bestWeapon:5,teamNumber:1,gameRank:2,
  killDetails:{'1':2,'91':0,nickname:9,'3':-1,'4':'2','5':1.5},deathDetails:{'7':1},
  killerUserNum:123,killDetail:'private nickname'};
const expected={killDetails:{'1':2,'91':0},deathDetails:{'7':1}};
assert.deepEqual(encounterStats(input),expected);
assert.deepEqual(encounterStats({}),{},'missing observations stay missing, not zero deaths');
assert.deepEqual(encounterStats({killDetails:[]}),{});
const teams=normalizeGame(1,{userGames:[input,{...input,characterNum:7}]},{});
const text=JSON.stringify(teams);
assert.ok(!text.includes('private nickname')&&!text.includes('killerUserNum'));
assert.ok(text.includes('"killDetails":{"1":2,"91":0}'));
console.log('Encounter aggregate preservation and privacy checks passed.');
