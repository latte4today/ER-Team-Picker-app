/**
 * Append newly collected official match teams to a date-based gzip JSONL shard.
 *
 * This is the durable ML archive entry point. It does not replace or rewrite
 * previous shards; each run appends one gzip member to the selected date shard.
 *
 * Usage:
 *   node tools/archive_official_matches.mjs \
 *     --in data/official-match-input-seeded.json \
 *     --archive-dir data/official-archive \
 *     --patch current
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function parseArgs() {
  const args = {
    in: path.join(ROOT, "data", "official-match-input-seeded.json"),
    archiveDir: path.join(ROOT, "data", "official-archive"),
    date: new Date().toISOString().slice(0, 10),
    patch: process.env.CURRENT_PATCH || "current",
    source: "official-api",
  };

  for (let index = 2; index < process.argv.length; index += 1) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (!key.startsWith("--")) continue;
    index += 1;
    if (key === "--in") args.in = path.resolve(ROOT, value);
    else if (key === "--archive-dir") args.archiveDir = path.resolve(ROOT, value);
    else if (key === "--date") args.date = value;
    else if (key === "--patch") args.patch = value;
    else if (key === "--source") args.source = value;
  }

  return args;
}

function teamKey(team) {
  return `${team?.gameId ?? "unknown"}:${team?.teamKey ?? "unknown"}`;
}

async function readTeams(inputPath) {
  const raw = await fsp.readFile(inputPath, "utf8");
  const payload = JSON.parse(raw);
  return Array.isArray(payload?.teams) ? payload.teams : [];
}

async function readManifest(manifestPath) {
  try {
    return JSON.parse(await fsp.readFile(manifestPath, "utf8"));
  } catch {
    return { version: 1, shards: {}, runs: [] };
  }
}

async function writeManifest(manifestPath, manifest) {
  await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function appendGzipJsonl(shardPath, teams, metadata) {
  async function* lines() {
    for (const team of teams) {
      const archived = {
        ...team,
        collectedAt: team.collectedAt || metadata.collectedAt,
        sourcePatch: team.sourcePatch || metadata.patch,
      };
      yield `${JSON.stringify(archived)}\n`;
    }
  }

  const gzip = createGzip({ level: 9 });
  const output = fs.createWriteStream(shardPath, { flags: "a" });
  await pipeline(Readable.from(lines(), { encoding: "utf8" }), gzip, output);
}

async function main() {
  const args = parseArgs();
  const collectedAt = new Date().toISOString();
  await fsp.mkdir(args.archiveDir, { recursive: true });

  const shardName = `matches-${args.date}.jsonl.gz`;
  const shardPath = path.join(args.archiveDir, shardName);
  const manifestPath = path.join(args.archiveDir, "manifest.json");

  const inputTeams = await readTeams(args.in);
  const seenInRun = new Set();
  const teams = [];
  for (const team of inputTeams) {
    const key = teamKey(team);
    if (seenInRun.has(key)) continue;
    seenInRun.add(key);
    teams.push(team);
  }

  if (teams.length) {
    await appendGzipJsonl(shardPath, teams, { collectedAt, patch: args.patch });
  }

  const manifest = await readManifest(manifestPath);
  const stat = await fsp.stat(shardPath).catch(() => undefined);
  const shard = manifest.shards[shardName] || { runs: 0, teams: 0 };
  shard.runs += 1;
  shard.teams += teams.length;
  shard.lastRunAt = collectedAt;
  shard.patch = args.patch;
  shard.bytes = stat?.size ?? 0;
  manifest.version = 1;
  manifest.updatedAt = collectedAt;
  manifest.archiveDir = path.relative(ROOT, args.archiveDir).replace(/\\/g, "/");
  manifest.shards[shardName] = shard;
  manifest.runs.push({
    at: collectedAt,
    source: args.source,
    patch: args.patch,
    input: path.relative(ROOT, args.in).replace(/\\/g, "/"),
    shard: shardName,
    inputTeams: inputTeams.length,
    archivedTeams: teams.length,
  });
  await writeManifest(manifestPath, manifest);

  console.log(`Archived official teams: ${teams.length}/${inputTeams.length}`);
  console.log(`  shard: ${path.relative(ROOT, shardPath)}`);
  console.log(`  manifest: ${path.relative(ROOT, manifestPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
