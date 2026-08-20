import { officialPairRoleStatsByTier, pairRoleStatsMeta } from "../src/pairRoleStats.js";

const errors = [];
let rows = 0;
for (const [bucket, stats] of Object.entries(officialPairRoleStatsByTier ?? {})) {
  const entries = Object.entries(stats ?? {});
  rows += entries.length;
  if ((pairRoleStatsMeta.rowsByTier?.[bucket] ?? -1) !== entries.length) {
    errors.push(`${bucket}: metadata row count mismatch`);
  }
  for (const [key, row] of entries) {
    if ((row.games ?? 0) < pairRoleStatsMeta.minGames) errors.push(`${key}: insufficient games`);
    if ((row.candidates ?? 0) < pairRoleStatsMeta.minCandidates) errors.push(`${key}: insufficient candidates`);
    if (!Array.isArray(row.teammates) || row.teammates.length !== 2) errors.push(`${key}: invalid teammates`);
    if (!key.endsWith(`#${row.role}`)) errors.push(`${key}: role/key mismatch`);
    for (const field of ["winRate", "top3Rate", "baselineWinRate", "baselineTop3Rate"]) {
      if (!Number.isFinite(row[field]) || row[field] < 0 || row[field] > 1) errors.push(`${key}: invalid ${field}`);
    }
  }
}

if (errors.length) {
  console.error(`# pair-role stats check failed (${errors.length} issues)`);
  errors.slice(0, 25).forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`# pair-role stats check passed: rows=${rows} minGames=${pairRoleStatsMeta.minGames} minCandidates=${pairRoleStatsMeta.minCandidates}`);
console.log(`# sourceTeams=${pairRoleStatsMeta.sourceTeams} rowsByTier=${JSON.stringify(pairRoleStatsMeta.rowsByTier)}`);
