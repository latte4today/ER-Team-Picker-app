// Retain only public season metadata, never page props or player information.
import {setTimeout as delay} from 'node:timers/promises';
export const SEASON_URL = 'https://dak.gg/er/characters/Niah?hl=ko&tier=diamond_plus';
let catalog;

async function publicJson(path) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch('https://er.dakgg.io' + path, {
      signal: AbortSignal.timeout(25000),
      headers: {'User-Agent': 'ER-Team-Picker aggregate updater'},
    });
    if (response.ok) return response.json();
    if (attempt === 2 || (response.status !== 429 && response.status < 500)) throw Error(`Public aggregates HTTP ${response.status}`);
    await delay(1500 * (attempt + 1));
  }
}

async function publicCatalog() {
  if (!catalog) {
    catalog = Promise.all([
      publicJson('/api/v1/data/seasons?hl=ko'),
      publicJson('/api/v1/data/characters?hl=ko'),
    ]).then(([seasons, characters]) => ({
      seasons: seasons.seasons,
      characters: characters.characters.map(({id, key}) => ({id, key})),
    }));
  }
  return catalog;
}

export async function publicPage(url) {
  const source = new URL(url);
  const {seasons, characters} = await publicCatalog();
  const active = seasons.filter((season) => season.isCurrent);
  if (active.length !== 1) throw Error('Expected exactly one current season');
  const isPreSeason = active[0].key.startsWith('PRE_');
  const tier = isPreSeason ? 'unrank' : source.searchParams.get('tier') ?? 'diamond_plus';
  const query = new URLSearchParams({
    character: decodeURIComponent(source.pathname.split('/').at(-1)),
    dt: source.searchParams.get('dt') ?? '7',
    teamMode: 'SQUAD',
    matchingMode: isPreSeason ? 'NORMAL' : 'RANK',
  });
  if (!isPreSeason) query.set('tier', tier);
  const stats = await publicJson('/api/v1/character-stats?' + query);
  const {meta, characterDetailStatSnapshot} = stats;
  if (!meta || !characterDetailStatSnapshot) throw Error('Missing public aggregate statistics');
  return {isPreSeason, dehydratedState: {queries: [
    {queryKey: ['GET_SEASONS_KEY'], state: {data: {seasons}}},
    {queryKey: ['GET_CHARACTERS_KEY'], state: {data: {characters}}},
    {queryKey: ['getCharacterStatistics'], state: {data: {meta, characterDetailStatSnapshot}}},
  ]}};
}
export function seasonFromPage(page, previous, now = new Date().toISOString()) {
  const seasons = page.dehydratedState?.queries?.find(q=>q.queryKey[0]==='GET_SEASONS_KEY')?.state.data.seasons;
  const active = seasons?.filter(s=>s.isCurrent);
  if (active?.length !== 1) throw Error('Expected exactly one current season');
  const s = active[0], preseason = s.key?.startsWith('PRE_');
  const displaySeason = Number(s.name?.match(/(\d+)\s*$/)?.[1]);
  const patch = page.dehydratedState.queries.find(q=>q.queryKey[0]==='getCharacterStatistics')?.state.data.meta.patch;
  if (!/^(PRE_)?SEASON_\d+$/.test(s.key) || !Number.isInteger(s.id) || s.id <= 0
      || typeof page.isPreSeason !== 'boolean' || preseason !== page.isPreSeason
      || !Number.isInteger(displaySeason) || displaySeason <= 0 || !Number.isInteger(patch)) throw Error('Inconsistent season metadata');
  if (previous && (s.id < previous.seasonId || (s.id === previous.seasonId && patch < previous.patch))) throw Error('Season metadata rollback');
  // The statistics service can lag the season switch. Publish the phase change
  // independently; collection rejects its lagging patch instead of relabelling it.
  return {schemaVersion:1,generatedAt:now,seasonId:s.id,seasonKey:s.key,displaySeason,
    phase:preseason?'preseason':'ranked',patch,
    phaseStartedAt:s.id===previous?.seasonId?previous.phaseStartedAt:now};
}
