export function sampleWeight(games, priorGames) {
  return Number.isFinite(games) && games > 0 ? games / (games + priorGames) : 0;
}

export function isValidRankStat(row) {
  return Number.isFinite(row?.games) && row.games > 0
    && Number.isFinite(row.winRate) && Number.isFinite(row.top3Rate)
    && row.winRate >= 0 && row.winRate <= row.top3Rate && row.top3Rate <= 1
    && Number.isFinite(row.avgPlacement) && row.avgPlacement >= 1;
}

export function rankBaseline(rows) {
  let games=0,winRate=0,top3Rate=0,avgPlacement=0;
  for(const row of rows) {
    if(!isValidRankStat(row))continue;
    games+=row.games;
    winRate+=row.winRate*row.games;top3Rate+=row.top3Rate*row.games;avgPlacement+=row.avgPlacement*row.games;
  }
  return games>0 ? {winRate:winRate/games,top3Rate:top3Rate/games,avgPlacement:avgPlacement/games}
    : {winRate:0.14,top3Rate:0.42,avgPlacement:4.5};
}

// Identical outcome scale for all roles. Shrink toward the observed field
// rather than giving raw games played a positive score of its own.
export function calibratedRankScore(row, baseline, priorGames=260) {
  if(!isValidRankStat(row))return 0;
  const raw=7.2*(row.top3Rate-baseline.top3Rate)+4.8*(row.winRate-baseline.winRate)
    +0.82*(baseline.avgPlacement-row.avgPlacement);
  return raw*sampleWeight(row.games,priorGames);
}
