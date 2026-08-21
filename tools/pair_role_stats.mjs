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

function aggregateRate(aggregate, field) {
  if (!aggregate?.games) return null;
  return aggregate[field] / aggregate.games;
}

function logit(rate) {
  const clipped = Math.max(0.001, Math.min(0.999, rate));
  return Math.log(clipped / (1 - clipped));
}

function logistic(value) {
  return 1 / (1 + Math.exp(-value));
}

function additiveExpectedRate(candidate, pair, global, field) {
  const candidateRate = aggregateRate(candidate, field);
  const pairRate = aggregateRate(pair, field);
  const globalRate = aggregateRate(global, field);
  if (![candidateRate, pairRate, globalRate].every(Number.isFinite)) return globalRate ?? 0;
  return logistic(logit(candidateRate) + logit(pairRate) - logit(globalRate));
}

function aggregatePlacement(aggregate) {
  return aggregate?.placementGames ? aggregate.placementSum / aggregate.placementGames : null;
}

function additiveExpectedPlacement(candidate, pair, global) {
  const candidatePlacement = aggregatePlacement(candidate);
  const pairPlacement = aggregatePlacement(pair);
  const globalPlacement = aggregatePlacement(global);
  if (![candidatePlacement, pairPlacement, globalPlacement].every(Number.isFinite)) return globalPlacement;
  return candidatePlacement + pairPlacement - globalPlacement;
}

export function buildOfficialPairRoleStats(
  compositionStatsByTier = {},
  { minGames = 60, minCandidates = 2 } = {},
) {
  const output = {};

  for (const [bucket, rows] of Object.entries(compositionStatsByTier ?? {})) {
    const pairTotals = new Map();
    const candidateTotals = new Map();
    const globalTotals = emptyAggregate();
    const pairRoleTotals = new Map();

    // First pass: estimate the individual candidate and selected-pair main effects.
    for (const row of rows ?? []) {
      const teammates = [...new Set(row?.teammates ?? [])].sort();
      if (teammates.length !== 2 || !row?.candidate) continue;

      const pair = teammates.join("|");
      if (!candidateTotals.has(row.candidate)) candidateTotals.set(row.candidate, emptyAggregate());
      if (!pairTotals.has(pair)) pairTotals.set(pair, emptyAggregate());
      addWeightedRow(candidateTotals.get(row.candidate), row);
      addWeightedRow(pairTotals.get(pair), row);
      addWeightedRow(globalTotals, row);
    }

    // Second pass: actual pair+role outcomes and their additive solo+pair baseline.
    for (const row of rows ?? []) {
      const teammates = [...new Set(row?.teammates ?? [])].sort();
      const role = roleByVariant.get(row?.candidate);
      if (teammates.length !== 2 || !role) continue;

      const pair = teammates.join("|");
      const key = `${pair}#${role}`;
      if (!pairRoleTotals.has(key)) {
        pairRoleTotals.set(key, {
          ...emptyAggregate(),
          baselineWinSum: 0,
          baselineTop3Sum: 0,
          baselinePlacementSum: 0,
          baselinePlacementGames: 0,
          teammates,
          role,
          candidates: new Set(),
        });
      }

      const group = pairRoleTotals.get(key);
      addWeightedRow(group, row);
      group.candidates.add(row.candidate);
      const games = Number(row.games ?? 0);
      const candidateBaseline = candidateTotals.get(row.candidate);
      const pairBaseline = pairTotals.get(pair);
      if (games > 0 && candidateBaseline && pairBaseline) {
        group.baselineWinSum += additiveExpectedRate(candidateBaseline, pairBaseline, globalTotals, "winSum") * games;
        group.baselineTop3Sum += additiveExpectedRate(candidateBaseline, pairBaseline, globalTotals, "top3Sum") * games;
        const expectedPlacement = additiveExpectedPlacement(candidateBaseline, pairBaseline, globalTotals);
        if (Number.isFinite(expectedPlacement)) {
          group.baselinePlacementSum += expectedPlacement * games;
          group.baselinePlacementGames += games;
        }
      }
    }

    const bucketOutput = {};
    for (const [key, group] of [...pairRoleTotals.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (group.games < minGames || group.candidates.size < minCandidates) continue;
      if (!group.games) continue;

      bucketOutput[key] = {
        teammates: group.teammates,
        role: group.role,
        games: round(group.games, 2),
        candidates: group.candidates.size,
        avgPlacement: group.placementGames ? round(group.placementSum / group.placementGames, 2) : undefined,
        winRate: round(group.winSum / group.games),
        top3Rate: round(group.top3Sum / group.games),
        baselineAvgPlacement: group.baselinePlacementGames ? round(group.baselinePlacementSum / group.baselinePlacementGames, 2) : undefined,
        baselineWinRate: round(group.baselineWinSum / group.games),
        baselineTop3Rate: round(group.baselineTop3Sum / group.games),
      };
    }
    output[bucket] = bucketOutput;
  }

  return output;
}
