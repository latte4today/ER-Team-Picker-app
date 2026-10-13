// The listing used by DAK.GG's esports page, not a guessed sequence of IDs.
export async function discoverTournamentGames(fetchJson, knownIds, { maxPages = 20, size = 50 } = {}) {
  const found = new Map();
  let season = null;
  for (let page = 1; page <= maxPages; page += 1) {
    const data = await fetchJson(`https://er.dakgg.io/api/v1/tournament/recent-games?page=${page}&size=${size}`);
    if (!Array.isArray(data?.gameInfos) || !Number.isFinite(data.count)) throw new Error('Tournament listing schema changed');
    if (page === 1 && !data.gameInfos.length) throw new Error('Tournament listing unexpectedly empty; keep previous data');
    if (season === null) season = Math.max(...data.gameInfos.map(row => Number(row.seasonId) || 0));
    for (const row of data.gameInfos) {
      if (row.seasonId !== season || !Number.isSafeInteger(row.gameId)) continue;
      if (!knownIds.has(row.gameId)) found.set(row.gameId, { gameId: row.gameId, seasonId: row.seasonId, code: row.code });
    }
    if (page * size >= data.count || !data.gameInfos.length || data.gameInfos.every(row => row.seasonId < season)) {
      return { season, games: [...found.values()].sort((a,b) => a.gameId-b.gameId) };
    }
  }
  throw new Error(`Tournament listing exceeded ${maxPages} pages; refusing a silently truncated update`);
}
