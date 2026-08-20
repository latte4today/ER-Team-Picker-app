/**
 * Append newly collected official match teams to a date-based gzip JSONL shard.
 *
 * This is the durable ML archive entry point. It does not replace or rewrite
 * previous shards; each run writes one immutable gzip shard.
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
    seenGames: null,
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
    else if (key === "--seen-games") args.seenGames = path.resolve(ROOT, value);
  }

  args.seenGames ||= path.join(args.archiveDir, "seen-game-ids.txt");

  return args;
}

async function readSeenGames(indexPath) {
  try {
    const raw = await fsp.readFile(indexPath, "utf8");
    return new Set(raw.split(/\r?\n/).map((value) => value.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

async function hasArchiveShards(archiveDir) {
  const entries = await fsp.readdir(archiveDir, { withFileTypes: true }).catch(() => []);
  return entries.some((entry) => entry.isFile() && /^matches-\d{4}-\d{2}-\d{2}(?:-[a-zA-Z0-9._-]+)?\.jsonl(\.gz)?$/.test(entry.name));
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

async function writeGzipJsonl(shardPath, teams, metadata) {
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
  const output = fs.createWriteStream(shardPath, { flags: "wx" });
  await pipeline(Readable.from(lines(), { encoding: "utf8" }), gzip, output);
}

async function main() {
  const args = parseArgs();
  const collectedAt = new Date().toISOString();
  await fsp.mkdir(args.archiveDir, { recursive: true });

  const runStamp = collectedAt.replace(/[-:.]/g, "").split("T")[1];
  const shardName = `matches-${args.date}-${runStamp}.jsonl.gz`;
  const shardPath = path.join(args.archiveDir, shardName);
  const manifestPath = path.join(args.archiveDir, "manifest.json");

  const inputTeams = await readTeams(args.in);
  if (!fs.existsSync(args.seenGames) && await hasArchiveShards(args.archiveDir)) {
    throw new Error(
      `Archive game index is missing: ${path.relative(ROOT, args.seenGames)}. ` +
      "Run tools/build_archive_seen_games.mjs before appending."
    );
  }
  const seenGames = await readSeenGames(args.seenGames);
  const seenInRun = new Set();
  const newGameIds = new Set();
  const teams = [];
  for (const team of inputTeams) {
    const key = teamKey(team);
    if (seenInRun.has(key)) continue;
    seenInRun.add(key);
    const gameId = String(team?.gameId ?? "").trim();
    if (!gameId || seenGames.has(gameId)) continue;
    newGameIds.add(gameId);
    teams.push(team);
  }

  if (teams.length) {
    await writeGzipJsonl(shardPath, teams, { collectedAt, patch: args.patch });
  }
  if (newGameIds.size) {
    await fsp.mkdir(path.dirname(args.seenGames), { recursive: true });
    await fsp.appendFile(args.seenGames, `${[...newGameIds].join("\n")}\n`, "utf8");
  } else if (!fs.existsSync(args.seenGames)) {
    await fsp.writeFile(args.seenGames, "", "utf8");
  }

  const manifest = await readManifest(manifestPath);
  const stat = await fsp.stat(shardPath).catch(() => undefined);
  manifest.version = 1;
  manifest.updatedAt = collectedAt;
  manifest.archiveDir = path.relative(ROOT, args.archiveDir).replace(/\\/g, "/");
  if (teams.length) {
    manifest.shards[shardName] = {
      runs: 1,
      teams: teams.length,
      lastRunAt: collectedAt,
      patch: args.patch,
      bytes: stat?.size ?? 0,
      immutable: true,
    };
  }
  manifest.runs.push({
    at: collectedAt,
    source: args.source,
    patch: args.patch,
    input: path.relative(ROOT, args.in).replace(/\\/g, "/"),
    shard: teams.length ? shardName : null,
    inputTeams: inputTeams.length,
    archivedTeams: teams.length,
    skippedPreviouslyArchivedTeams: inputTeams.length - teams.length,
    archivedGames: newGameIds.size,
  });
  await writeManifest(manifestPath, manifest);

  console.log(`Archived official teams: ${teams.length}/${inputTeams.length}`);
  console.log(`  new games: ${newGameIds.size}  previously seen games: ${seenGames.size}`);
  console.log(`  shard: ${path.relative(ROOT, shardPath)}`);
  console.log(`  manifest: ${path.relative(ROOT, manifestPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
