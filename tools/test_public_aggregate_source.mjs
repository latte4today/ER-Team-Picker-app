import assert from 'node:assert/strict';
import {publicPage, seasonFromPage, SEASON_URL} from './season_metadata.mjs';

const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url) => {
  const target = new URL(url);
  calls.push(target);
  assert.equal(target.origin, 'https://er.dakgg.io');
  if (target.pathname.endsWith('/seasons')) return Response.json({seasons: [
    {id: 42, key: 'PRE_SEASON_22', name: '프리 시즌 13', isCurrent: true},
  ]});
  if (target.pathname.endsWith('/characters')) return Response.json({characters: [
    {id: 81, key: 'Niah', privateUnneededField: 'omit'},
  ]});
  const days = Number(target.searchParams.get('dt'));
  assert.equal(target.searchParams.get('matchingMode'), 'NORMAL');
  assert.equal(target.searchParams.get('teamMode'), 'SQUAD');
  assert.equal(target.searchParams.has('tier'), false);
  assert.equal(target.searchParams.get('character'), 'Niah');
  return Response.json({
    meta: {patch: 13000, tier: 'unrank', dt: days, updatedAt: Date.now()},
    characterDetailStatSnapshot: {matchingMode: 2, teamMode: 3, patch: 13000, dt: days},
    players: [{nickname: 'never-retain-player-data'}],
    weaponRoutes: ['unneeded-route'],
  });
};
try {
  const first = await publicPage(SEASON_URL);
  assert.equal(seasonFromPage(first).phase, 'preseason');
  assert.doesNotMatch(JSON.stringify(first), /never-retain-player-data|unneeded-route|privateUnneededField/);
  const short = await publicPage(SEASON_URL + '&dt=3');
  assert.equal(short.dehydratedState.queries.at(-1).state.data.meta.dt, 3);
  assert.equal(calls.length, 4, 'catalog metadata should be reused for per-character requests');
} finally {
  globalThis.fetch = originalFetch;
}
console.log('Public aggregates use API endpoints, preserve current mode and window, and omit player data.');
