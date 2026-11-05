// Retain only public season metadata, never page props or player information.
export const SEASON_URL = 'https://dak.gg/er/characters/Niah?hl=ko&tier=diamond_plus';
export async function publicPage(url) {
  const response = await fetch(url, {signal:AbortSignal.timeout(25000),headers:{'User-Agent':'ER-Team-Picker aggregate updater'}});
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  const html = await response.text();
  const data = JSON.parse(html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? 'null');
  if (!data?.props?.pageProps) throw Error('Missing public season metadata');
  return data.props.pageProps;
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
