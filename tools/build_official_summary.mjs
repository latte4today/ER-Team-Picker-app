/**
 * Build a small summary counter file from official match archive shards.
 *
 * This is intentionally compact and stream-based. It is not the app bundle;
 * it is the production-side enough-statistics checkpoint for monitoring and
 * later incremental aggregation work.
 *
 * Usage:
 *   node tools/build_official_summary.mjs \
 *     --archive-dir data/official-archive \
 *     --out reports/officialMatchSummary.json
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { createGunzip } from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function parseArgs() {
  const args = {
    archiveDir: path.join(ROOT, "data", "official-archive"),
    out: path.join(ROOT, "reports", "officialMatchSummary.json"),
  };
  for (let index = 2; index < process.argv.length; index += 1) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (!key.startsWith("--")) continue;
    index += 1;
    if (key === "--archive-dir") args.archiveDir = path.resolve(ROOT, value);
    else if (key === "--out") args.out = path.resolve(ROOT, value);
  }
  return args;
}

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function bucketFor(team) {
  return team?.tierBucket || "unknown";
}

function bump(target, key, amount = 1) {
  const text = String(key || "unknown");
  target[text] = (target[text] || 0) + amount;
}

function ensureStat(target, key) {
  const text = String(key || "unknown");
  if (!target[text]) {
    target[text] = { games: 0, wins: 0, top3: 0, placementSum: 0, placementGames: 0 };
  }
  return target[text];
}

function addResult(stat, team) {
  const rank = numeric(team?.rank, 0);
  stat.games += 1;
  if (team?.victory || rank === 1) stat.wins += 1;
  if (rank > 0 && rank <= 3) stat.top3 += 1;
  if (rank > 0) {
    stat.placementSum += rank;
    stat.placementGames += 1;
  }
}

function rawPlayerKey(player) {
  return `${player?.character ?? "unknown"}:${player?.weapon ?? "unknown"}`;
}

function pairKey(a, b) {
  return [a, b].sort().join("|");
}

async function listShards(archiveDir) {
  try {
    const entries = await fsp.readdir(archiveDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /^matches-\d{4}-\d{2}-\d{2}\.jsonl(\.gz)?$/.test(entry.name))
      .map((entry) => path.join(archiveDir, entry.name))
      .sort();
  } catch {
    return [];
  }
}

function lineReader(filePath) {
  const input = fs.createReadStream(filePath);
  const stream = filePath.endsWith(".gz") ? input.pipe(createGunzip()) : input;
  return readline.createInterface({ input: stream, crlfDelay: Infinity });
}

async function main() {
  const args = parseArgs();
  const shards = await listShards(args.archiveDir);
  const summary = {
    version: 1,
    generatedAt: new Date().toISOString(),
    archiveDir: path.relative(ROOT, args.archiveDir).replace(/\\/g, "/"),
    shards: [],
    totals: { teams: 0, players: 0 },
    byTier: {},
    byFineTier: {},
    byPatch: {},
    rawCandidateByTier: {},
    rawTraitCoreByTier: {},
    rawPairByTier: {},
  };

  for (const shardPath of shards) {
    const shardName = path.basename(shardPath);
    let shardTeams = 0;
    const rl = lineReader(shardPath);
    for await (const line of rl) {
      if (!line.trim()) continue;
      let team;
      try {
        team = JSON.parse(line);
      } catch {
        continue;
      }

      const tier = bucketFor(team);
      const fineTier = team.fineBucket || "unknown";
      const patch = team.sourcePatch || "unknown";
      shardTeams += 1;
      summary.totals.teams += 1;
      summary.totals.players += Array.isArray(team.players) ? team.players.length : 0;
      addResult(ensureStat(summary.byTier, tier), team);
      addResult(ensureStat(summary.byFineTier, fineTier), team);
      bump(summary.byPatch, patch);

      if (!summary.rawCandidateByTier[tier]) summary.rawCandidateByTier[tier] = {};
      if (!summary.rawTraitCoreByTier[tier]) summary.rawTraitCoreByTier[tier] = {};
      if (!summary.rawPairByTier[tier]) summary.rawPairByTier[tier] = {};

      const playerKeys = [];
      for (const player of team.players || []) {
        const key = rawPlayerKey(player);
        playerKeys.push(key);
        bump(summary.rawCandidateByTier[tier], key);
        const core = player?.traits?.core;
        if (core !== undefined && core !== null && core !== "") {
          bump(summary.rawTraitCoreByTier[tier], `${key}#${core}`);
        }
      }
      for (let i = 0; i < playerKeys.length; i += 1) {
        for (let j = i + 1; j < playerKeys.length; j += 1) {
          bump(summary.rawPairByTier[tier], pairKey(playerKeys[i], playerKeys[j]));
        }
      }
    }
    const stat = await fsp.stat(shardPath);
    summary.shards.push({ name: shardName, teams: shardTeams, bytes: stat.size });
  }

  await fsp.mkdir(path.dirname(args.out), { recursive: true });
  await fsp.writeFile(args.out, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(`Official summary: ${path.relative(ROOT, args.out)}`);
  console.log(`  shards: ${summary.shards.length}`);
  console.log(`  teams: ${summary.totals.teams}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
