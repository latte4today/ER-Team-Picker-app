import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { discoverTournamentGames } from './tournament_discovery.mjs';
import { validTournamentData } from '../src/tournamentData.js';
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
const { updateTournamentStats, evaluateCandidate }=await import('../src/recommender.js');
const pages=[{count:4,gameInfos:[{gameId:8041,seasonId:41},{gameId:7726,seasonId:41}]},
  {count:4,gameInfos:[{gameId:7690,seasonId:41},{gameId:7500,seasonId:40}]}];
const fetchListing=async url=>pages[Number(new URL(url).searchParams.get('page'))-1];
assert.deepEqual((await discoverTournamentGames(fetchListing,new Set([7726]),{size:2})).games.map(r=>r.gameId),[7690,8041],
  'published games across a gap and late-published older IDs are discovered');
assert.equal((await discoverTournamentGames(fetchListing,new Set([8041,7726,7690]),{size:2})).games.length,0);
await assert.rejects(()=>discoverTournamentGames(async()=>({gameInfos:[],count:0}),new Set()),/empty/);
await assert.rejects(()=>discoverTournamentGames(async()=>({}),new Set()),/schema/);
await assert.rejects(()=>discoverTournamentGames(fetchListing,new Set(),{size:2,maxPages:1}),/truncated/);
const rollover=await discoverTournamentGames(async()=>({count:1,gameInfos:[{gameId:9000,seasonId:42}]}),new Set([8041]));
assert.equal(rollover.season,42);
const root=path.resolve(import.meta.dirname,'..');
const scratch=await fs.mkdtemp(path.join(root,'../../tournament-test-'));
try {
  const base={seasonId:41,teamNumber:1,placement:1,win:1,top3:1,characterNums:[31,90,91],
    players:[{characterNum:31,weaponCode:7,core:7000401},{characterNum:90,weaponCode:16,core:7000401},{characterNum:91,weaponCode:5,core:7200301}],rankScore:10,killScore:10};
  const input=path.join(scratch,'input.json'),output=path.join(scratch,'meta.js');
  await fs.writeFile(input,JSON.stringify([{...base,gameId:1},{...base,gameId:2},{...base,gameId:1}]));
  const result=spawnSync(process.execPath,['tools/build_tournament_meta.mjs','--in',input,'--out',output],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const payload=JSON.parse(await fs.readFile(output.replace('.js','.compact.json'),'utf8'));
  assert.equal(payload.totalGames,2);assert.equal(payload.builds[0].appearances,2,'duplicate teams cannot inflate build counts');
  assert.equal(payload.compositions[0].appearances,2);
  assert.ok(validTournamentData(payload));
  const before=evaluateCandidate(['rio:bow','lucia:sniper_rifle'],'seres:two_handed_sword').scores.tournamentComposition;
  assert.ok(updateTournamentStats(payload));
  const after=evaluateCandidate(['rio:bow','lucia:sniper_rifle'],'seres:two_handed_sword').scores.tournamentComposition;
  assert.notEqual(before,after,'remote tournament updates rebuild scoring indexes');
  assert.equal(updateTournamentStats({}),false);
  assert.equal(evaluateCandidate(['rio:bow','lucia:sniper_rifle'],'seres:two_handed_sword').scores.tournamentComposition,after,'invalid remote data keeps the last valid scores');
  assert.equal(validTournamentData({...payload,builds:[{members:[null,null,null]}]}),false);
} finally {
  assert.ok(scratch.startsWith(path.resolve(root,'../..')+path.sep));
  await fs.rm(scratch,{recursive:true,force:true});
}
console.log('Tournament sync: gaps, delayed IDs, no-op, season rollover, failure retention, dedup, actual weapons/cores and scoring refresh passed.');
