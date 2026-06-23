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
 *
 * Incremental mode:
 *   node tools/build_official_summary.mjs \
 *     --archive-dir data/official-archive \
 *     --previous data/official-archive/officialMatchSummary.json \
 *     --state data/official-archive/summary-state.json \
 *     --out data/official-archive/officialMatchSummary.json \
 *     --incremental
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
    previous: undefined,
    state: undefined,
    incremental: false,
  };
  for (let index = 2; index < process.argv.length; index += 1) {
    const key = process.argv[index];
    if (key === "--incremental") {
      args.incremental = true;
      continue;
    }
    const value = process.argv[index + 1];
    if (!key.startsWith("--")) continue;
    index += 1;
    if (key === "--archive-dir") args.archiveDir = path.resolve(ROOT, value);
    else if (key === "--out") args.out = path.resolve(ROOT, value);
    else if (key === "--previous") args.previous = path.resolve(ROOT, value);
    else if (key === "--state") args.state = path.resolve(ROOT, value);
  }
  args.state ||= path.join(args.archiveDir, "summary-state.json");
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

function lineReader(filePath, start = 0) {
  const input = fs.createReadStream(filePath, { start });
  const stream = filePath.endsWith(".gz") ? input.pipe(createGunzip()) : input;
  return readline.createInterface({ input: stream, crlfDelay: Infinity });
}

function emptySummary(args) {
  return {
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
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function addTeam(summary, team) {
  const tier = bucketFor(team);
  const fineTier = team.fineBucket || "unknown";
  const patch = team.sourcePatch || "unknown";
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

function upsertShard(summary, shardName, next) {
  const existing = summary.shards.find((item) => item.name === shardName);
  if (existing) {
    existing.teams = (existing.teams || 0) + next.teams;
    existing.bytes = next.bytes;
  } else {
    summary.shards.push(next);
    summary.shards.sort((a, b) => a.name.localeCompare(b.name));
  }
}

async function processShard(summary, shardPath, startByte) {
  const shardName = path.basename(shardPath);
  let shardTeams = 0;
  const rl = lineReader(shardPath, startByte);
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      addTeam(summary, JSON.parse(line));
      shardTeams += 1;
    } catch {
      // Skip malformed lines; archive shards are append-only and should keep moving.
    }
  }
  const stat = await fsp.stat(shardPath);
  upsertShard(summary, shardName, { name: shardName, teams: shardTeams, bytes: stat.size });
  return { name: shardName, teams: shardTeams, bytes: stat.size };
}

async function main() {
  const args = parseArgs();
  const shards = await listShards(args.archiveDir);
  const previousPath = args.previous || args.out;
  const hasPreviousSummary = args.incremental && fs.existsSync(previousPath);
  let state = hasPreviousSummary
    ? await readJson(args.state, { version: 1, processedShards: {} })
    : { version: 1, processedShards: {} };
  let summary = hasPreviousSummary
    ? await readJson(previousPath, emptySummary(args))
    : emptySummary(args);

  summary.version = 1;
  summary.generatedAt = new Date().toISOString();
  summary.archiveDir = path.relative(ROOT, args.archiveDir).replace(/\\/g, "/");
  summary.shards ||= [];
  summary.totals ||= { teams: 0, players: 0 };
  summary.byTier ||= {};
  summary.byFineTier ||= {};
  summary.byPatch ||= {};
  summary.rawCandidateByTier ||= {};
  summary.rawTraitCoreByTier ||= {};
  summary.rawPairByTier ||= {};

  let processed = state.processedShards || {};
  const hasShrunkShard = args.incremental && shards.some((shardPath) => {
    const shardName = path.basename(shardPath);
    const size = fs.statSync(shardPath).size;
    return Number(processed[shardName]?.bytes || 0) > size;
  });
  if (hasShrunkShard) {
    console.warn("Archive shard size moved backwards; rebuilding summary from scratch.");
    summary = emptySummary(args);
    state = { version: 1, processedShards: {} };
    processed = state.processedShards;
  }
  let processedShardCount = 0;
  let processedTeams = 0;

  for (const shardPath of shards) {
    const shardName = path.basename(shardPath);
    const stat = await fsp.stat(shardPath);
    const priorBytes = args.incremental ? Number(processed[shardName]?.bytes || 0) : 0;
    if (args.incremental && priorBytes === stat.size) {
      continue;
    }
    const startByte = priorBytes > 0 && priorBytes < stat.size ? priorBytes : 0;
    const result = await processShard(summary, shardPath, startByte);
    processed[shardName] = { bytes: result.bytes, teams: (processed[shardName]?.teams || 0) + result.teams };
    processedShardCount += 1;
    processedTeams += result.teams;
  }

  await fsp.mkdir(path.dirname(args.out), { recursive: true });
  await fsp.writeFile(args.out, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  state.version = 1;
  state.updatedAt = summary.generatedAt;
  state.archiveDir = summary.archiveDir;
  state.processedShards = processed;
  await fsp.mkdir(path.dirname(args.state), { recursive: true });
  await fsp.writeFile(args.state, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  console.log(`Official summary: ${path.relative(ROOT, args.out)}`);
  console.log(`  shards: ${summary.shards.length}`);
  console.log(`  teams: ${summary.totals.teams}`);
  console.log(`  processed this run: ${processedShardCount} shards, ${processedTeams} teams`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
