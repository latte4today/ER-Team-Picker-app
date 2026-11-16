import { characterVariants } from "./data.js";
import { characterIdForCode } from "./officialCharacterCodes.js";
import { isValidRankStat, sampleWeight } from "./rankQuality.js";

const DAY_MS = 86_400_000;
const HISTORY_DAYS = 90;
const WEAPON_BY_MASTERY = {
  1: "glove", 2: "tonfa", 3: "bat", 4: "whip", 5: "throw", 6: "shuriken",
  7: "bow", 8: "crossbow", 9: "pistol", 10: "assault_rifle", 11: "sniper_rifle",
  13: "hammer", 14: "axe", 15: "dagger", 16: "two_handed_sword", 18: "dual_swords",
  19: "spear", 20: "nunchaku", 21: "rapier", 22: "guitar", 23: "camera",
  24: "arcana", 25: "vf_prosthetic",
};
const variantIds = new Set(characterVariants.map(({ variantId }) => variantId));

function variantFromMatch(match) {
  const characterId = characterIdForCode(match.characterNum);
  const weapon = WEAPON_BY_MASTERY[match.bestWeapon];
  const variantId = characterId === "alex" && weapon ? "alex:flex" : characterId + ":" + weapon;
  return variantIds.has(variantId) ? variantId : null;
}

function eligibleMatches(matches, now) {
  const seen = new Set();
  const eligible = [];
  for (const match of matches) {
    const mode = Number(match?.matchingMode);
    const gameId = Number(match?.gameId);
    const timestamp = Date.parse(match?.startDtm);
    const age = (now - timestamp) / DAY_MS;
    const rank = Number(match?.gameRank);
    if ((mode !== 2 && mode !== 3) || Number(match.matchingTeamMode) !== 3 ||
        !Number.isSafeInteger(gameId) || gameId <= 0 || seen.has(gameId) ||
        !Number.isInteger(rank) || rank <= 0 || !Number.isFinite(age) || age < -0.5 || age > HISTORY_DAYS) continue;
    const variantId = variantFromMatch(match);
    if (!variantId) continue;
    seen.add(gameId);
    eligible.push({ variantId, gameId, timestamp, rank, mode, seasonId: Number(match.seasonId), teamNumber: Number(match.teamNumber) });
  }
  return eligible;
}

function tally(record, rank) {
  record.games += 1;
  record.top3 += Number(rank <= 3);
  record.wins += Number(rank === 1);
  record.placement += rank;
}

function emptyRecord() {
  return { games: 0, top3: 0, wins: 0, placement: 0 };
}

export function summarizePlayerMatches(matches, now = Date.now()) {
  const byVariant = new Map();
  let rankedGames = 0;
  let normalGames = 0;
  for (const { variantId, mode, rank, seasonId } of eligibleMatches(matches, now)) {
    const row = byVariant.get(variantId) ?? { variantId, rankedGames: 0, normalGames: 0, rankedSeasons: {} };
    if (mode === 3) {
      rankedGames += 1;
      row.rankedGames += 1;
      if (Number.isInteger(seasonId) && seasonId > 0) {
        const record = row.rankedSeasons[seasonId] ?? emptyRecord();
        tally(record, rank);
        row.rankedSeasons[seasonId] = record;
      }
    } else {
      normalGames += 1;
      row.normalGames += 1;
    }
    byVariant.set(variantId, row);
  }
  return { days: HISTORY_DAYS, rankedGames, normalGames, variants: [...byVariant.values()] };
}

export function recentSquadGames(matches, seasonId, limit, now = Date.now()) {
  return eligibleMatches(matches, now)
    .filter((match) => match.mode === 3 && match.seasonId === seasonId && Number.isInteger(match.teamNumber) && match.teamNumber > 0)
    .sort((a, b) => b.timestamp - a.timestamp || b.gameId - a.gameId)
    .slice(0, limit);
}

function teamKey(variants) {
  return [...variants].sort().join("+");
}

export function addSquadResult(records, match, rows) {
  const squad = rows.filter((row) => Number(row?.teamNumber) === match.teamNumber);
  if (squad.length !== 3 || squad.some((row) => Number(row.gameId) !== match.gameId || Number(row.gameRank) !== match.rank)) return false;
  if (new Set(squad.map((row) => Number(row.characterNum))).size !== 3) return false;
  const variants = squad.map(variantFromMatch);
  if (variants.some((id) => !id) || !variants.includes(match.variantId)) return false;
  const teammates = variants.filter((id) => id !== match.variantId).sort();
  const key = match.variantId + "|" + teammates.join("+");
  const result = records.get(key) ?? { variantId: match.variantId, teammates, ...emptyRecord() };
  tally(result, match.rank);
  records.set(key, result);
  return true;
}

export function playerComparisonSeason(season, source) {
  const sourceId = Number(source?.seasonId);
  if (!Number.isInteger(sourceId) || sourceId <= 0 || Number(source.matchingMode) !== 3 ||
      Number(source.priorSeasonWeight ?? 0) > 0) return null;
  if (season?.phase === "ranked" && sourceId === season.seasonId) return { id: sourceId, weight: 1 };
  if (season?.phase === "preseason" && sourceId === season.seasonId - 1) return { id: sourceId, weight: 0.55 };
  return null;
}

function compareResults(record, baseline, minPersonal, minBaseline, prior) {
  if (record?.games < minPersonal || !record || baseline?.games < minBaseline || !isValidRankStat(baseline) ||
      !Number.isFinite(record.placement) || record.placement < record.games) return null;
  const top3Rate = record.top3 / record.games;
  const winRate = record.wins / record.games;
  const avgPlacement = record.placement / record.games;
  const top3Delta = top3Rate - baseline.top3Rate;
  const raw = 1.8 * top3Delta + 1.2 * (winRate - baseline.winRate) + 0.18 * (baseline.avgPlacement - avgPlacement);
  return {
    games: record.games, top3Rate, referenceTop3: baseline.top3Rate, winRate, referenceWin: baseline.winRate,
    weight: sampleWeight(record.games, prior), raw,
  };
}

export function personalPickEvidence(profile, cohort, candidateRows, compositionRows, teammates = []) {
  const matchingSquads = new Map();
  if (teammates.length === 2 && cohort && profile.squads?.seasonId === cohort.id) {
    const allies = teamKey(teammates);
    for (const row of profile.squads.entries) {
      if (row.teammates.join("+") === allies && row.games >= 3) {
        matchingSquads.set(teamKey([row.variantId, ...teammates]), row);
      }
    }
  }
  const teamBaselines = new Map();
  if (matchingSquads.size) {
    const [first, second] = teammates;
    for (const row of compositionRows ?? []) {
      if (row.teammates?.length !== 2 || row.games < 50 ||
          (row.candidate !== first && !row.teammates.includes(first)) ||
          (row.candidate !== second && !row.teammates.includes(second)) ||
          !isValidRankStat(row)) continue;
      const key = teamKey([row.candidate, ...row.teammates]);
      if (matchingSquads.has(key) && row.games > (teamBaselines.get(key)?.games ?? 0)) teamBaselines.set(key, row);
    }
  }

  return new Map((profile.variants ?? []).map(({ variantId, rankedGames, normalGames, rankedSeasons }) => {
    const individual = compareResults(rankedSeasons?.[cohort?.id], candidateRows?.[variantId], 5, 100, 20);
    const key = teamKey([variantId, ...teammates]);
    const squad = compareResults(matchingSquads.get(key), teamBaselines.get(key), 3, 50, 12);
    // Blend the exact-team comparison into the personal result so the same
    // matches do not count twice as independent evidence.
    const net = (individual ? individual.raw * individual.weight : 0) * (1 - (squad?.weight ?? 0))
      + (squad ? squad.raw * squad.weight : 0);
    const bonus = Math.max(-0.85, Math.min(0.85, net * (cohort?.weight ?? 0)));
    return [variantId, { rankedGames, normalGames, bonus, individual, squad }];
  }));
}
