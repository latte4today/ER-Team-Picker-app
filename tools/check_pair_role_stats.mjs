import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { officialPairRoleStatsByTier, pairRoleStatsMeta } from "../src/pairRoleStats.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function archiveDirArg() {
  const index = process.argv.indexOf("--archive-dir");
  return index > 0 && process.argv[index + 1] ? path.resolve(ROOT, process.argv[index + 1]) : null;
}

/** Teams the durable archive holds, or null when we cannot see the archive. */
function archiveTeamCount() {
  const dir = archiveDirArg();
  if (!dir) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
    const total = Object.values(manifest.shards ?? {})
      .reduce((sum, shard) => sum + (shard.teams ?? 0), 0);
    return total > 0 ? total : null;
  } catch {
    return null;
  }
}

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

// An empty table satisfies every per-row rule above, so it used to pass. Publishing
// zero pair-role stats silently disables the officialPairRole term for everyone.
const MIN_ROWS = Number(process.env.PAIR_ROLE_MIN_ROWS ?? 200);
if (rows < MIN_ROWS) {
  errors.push(`only ${rows} rows total (expected at least ${MIN_ROWS}) - the upstream build produced an empty or near-empty table`);
}

// Row counts alone did not catch the real failure: a corpus that had fallen a
// third behind the archive still produced 815 rows and passed. Anchor the check
// to the data we actually hold. Roughly half the archive survives the ranked-only
// filter, so the floor sits well under that and only fires on a gross shortfall.
const MIN_SOURCE_COVERAGE = Number(process.env.PAIR_ROLE_MIN_SOURCE_COVERAGE ?? 0.35);
const archiveTeams = archiveTeamCount();
if (archiveTeams) {
  const sourceTeams = pairRoleStatsMeta.sourceTeams ?? 0;
  const coverage = sourceTeams / archiveTeams;
  if (coverage < MIN_SOURCE_COVERAGE) {
    errors.push(
      `built from ${sourceTeams} teams but the archive holds ${archiveTeams} `
      + `(${(coverage * 100).toFixed(1)}%, floor ${(MIN_SOURCE_COVERAGE * 100).toFixed(0)}%) `
      + "- the corpus is behind the archive",
    );
  }
}

if (errors.length) {
  console.error(`# pair-role stats check failed (${errors.length} issues)`);
  errors.slice(0, 25).forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`# pair-role stats check passed: rows=${rows} minGames=${pairRoleStatsMeta.minGames} minCandidates=${pairRoleStatsMeta.minCandidates}`);
console.log(`# sourceTeams=${pairRoleStatsMeta.sourceTeams} rowsByTier=${JSON.stringify(pairRoleStatsMeta.rowsByTier)}`);
