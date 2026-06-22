/**
 * Build official full stats and compact stats from gzip archive shards.
 *
 * This keeps the app bundle path separate from the durable ML archive:
 * archive shards -> temporary JSONL corpus -> existing stats builder -> compact.
 *
 * Usage:
 *   node tools/build_compact_from_archive.mjs \
 *     --archive-dir data/official-archive \
 *     --work-dir reports/generated \
 *     --compact-out reports/generated/officialMatchStats.compact.json
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { createGunzip } from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function parseArgs() {
  const args = {
    archiveDir: path.join(ROOT, "data", "official-archive"),
    workDir: path.join(ROOT, "reports", "generated"),
    outJs: path.join(ROOT, "reports", "generated", "officialMatchStats.js"),
    outJson: path.join(ROOT, "reports", "generated", "officialMatchStats.json"),
    compactOut: path.join(ROOT, "reports", "generated", "officialMatchStats.compact.json"),
    minGames: "2",
    fetchCharacterData: true,
  };
  for (let index = 2; index < process.argv.length; index += 1) {
    const key = process.argv[index];
    if (key === "--no-fetch-character-data") {
      args.fetchCharacterData = false;
      continue;
    }
    const value = process.argv[index + 1];
    if (!key.startsWith("--")) continue;
    index += 1;
    if (key === "--archive-dir") args.archiveDir = path.resolve(ROOT, value);
    else if (key === "--work-dir") args.workDir = path.resolve(ROOT, value);
    else if (key === "--out-js") args.outJs = path.resolve(ROOT, value);
    else if (key === "--out-json") args.outJson = path.resolve(ROOT, value);
    else if (key === "--compact-out") args.compactOut = path.resolve(ROOT, value);
    else if (key === "--min-games") args.minGames = value;
  }
  return args;
}

async function listShards(archiveDir) {
  const entries = await fsp.readdir(archiveDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^matches-\d{4}-\d{2}-\d{2}\.jsonl(\.gz)?$/.test(entry.name))
    .map((entry) => path.join(archiveDir, entry.name))
    .sort();
}

function lineReader(filePath) {
  const input = fs.createReadStream(filePath);
  const stream = filePath.endsWith(".gz") ? input.pipe(createGunzip()) : input;
  return readline.createInterface({ input: stream, crlfDelay: Infinity });
}

async function materializeCorpus(shards, corpusPath) {
  const output = fs.createWriteStream(corpusPath, { encoding: "utf8" });
  const write = (text) => new Promise((resolve, reject) => {
    output.write(text, (error) => (error ? reject(error) : resolve()));
  });

  let lines = 0;
  for (const shard of shards) {
    const rl = lineReader(shard);
    for await (const line of rl) {
      if (!line.trim()) continue;
      await write(`${line}\n`);
      lines += 1;
    }
  }

  await new Promise((resolve, reject) => {
    output.end((error) => (error ? reject(error) : resolve()));
  });
  return lines;
}

function runNode(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: ROOT,
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(script)} exited with ${code}`));
    });
  });
}

async function main() {
  const args = parseArgs();
  await fsp.mkdir(args.workDir, { recursive: true });
  const shards = await listShards(args.archiveDir);
  if (!shards.length) throw new Error(`No archive shards found in ${path.relative(ROOT, args.archiveDir)}`);

  const corpusPath = path.join(args.workDir, "official-archive-corpus.jsonl");
  const lines = await materializeCorpus(shards, corpusPath);
  console.log(`Materialized archive corpus: ${path.relative(ROOT, corpusPath)} (${lines} teams)`);

  const buildArgs = [
    "tools/build_official_stats.mjs",
    "--in", path.relative(ROOT, corpusPath),
    "--out", path.relative(ROOT, args.outJs),
    "--json-out", path.relative(ROOT, args.outJson),
    "--min-games", args.minGames,
  ];
  if (!args.fetchCharacterData) buildArgs.push("--no-fetch-character-data");
  await runNode(buildArgs[0], buildArgs.slice(1));

  await runNode("tools/build_compact_stats.mjs", [
    "--in", path.relative(ROOT, args.outJson),
    "--out", path.relative(ROOT, args.compactOut),
  ]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
