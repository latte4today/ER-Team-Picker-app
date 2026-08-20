import { characterVariants } from "../src/data.js";

const roleByVariant = new Map(characterVariants.map((variant) => [variant.variantId, variant.role]));

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function addWeightedRow(target, row) {
  const games = Number(row?.games ?? 0);
  if (!(games > 0)) return;
  target.games += games;
  target.winSum += Number(row.winRate ?? 0) * games;
  target.top3Sum += Number(row.top3Rate ?? 0) * games;
  if (Number.isFinite(row.avgPlacement)) {
    target.placementSum += row.avgPlacement * games;
    target.placementGames += games;
  }
}

function emptyAggregate() {
  return { games: 0, winSum: 0, top3Sum: 0, placementSum: 0, placementGames: 0 };
}

export function buildOfficialPairRoleStats(
  compositionStatsByTier = {},
  { minGames = 60, minCandidates = 2 } = {},
) {
  const output = {};

  for (const [bucket, rows] of Object.entries(compositionStatsByTier ?? {})) {
    const pairTotals = new Map();
    const pairRoleTotals = new Map();

    for (const row of rows ?? []) {
      const teammates = [...new Set(row?.teammates ?? [])].sort();
      const role = roleByVariant.get(row?.candidate);
      if (teammates.length !== 2 || !role) continue;

      const pair = teammates.join("|");
      const key = `${pair}#${role}`;
      if (!pairTotals.has(pair)) pairTotals.set(pair, emptyAggregate());
      if (!pairRoleTotals.has(key)) {
        pairRoleTotals.set(key, {
          ...emptyAggregate(),
          teammates,
          role,
          candidates: new Set(),
        });
      }

      addWeightedRow(pairTotals.get(pair), row);
      const group = pairRoleTotals.get(key);
      addWeightedRow(group, row);
      group.candidates.add(row.candidate);
    }

    const bucketOutput = {};
    for (const [key, group] of [...pairRoleTotals.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (group.games < minGames || group.candidates.size < minCandidates) continue;
      const pair = group.teammates.join("|");
      const baseline = pairTotals.get(pair);
      if (!baseline?.games) continue;

      bucketOutput[key] = {
        teammates: group.teammates,
        role: group.role,
        games: round(group.games, 2),
        candidates: group.candidates.size,
        avgPlacement: group.placementGames ? round(group.placementSum / group.placementGames, 2) : undefined,
        winRate: round(group.winSum / group.games),
        top3Rate: round(group.top3Sum / group.games),
        baselineAvgPlacement: baseline.placementGames ? round(baseline.placementSum / baseline.placementGames, 2) : undefined,
        baselineWinRate: round(baseline.winSum / baseline.games),
        baselineTop3Rate: round(baseline.top3Sum / baseline.games),
      };
    }
    output[bucket] = bucketOutput;
  }

  return output;
}
