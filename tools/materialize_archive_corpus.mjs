/**
 * Materialize append-only official archive shards into one JSONL corpus.
 *
 * Durable archive shards live outside the app hot path as gzip JSONL files.
 * Backtests need a plain JSONL input, so this script streams every shard into
 * one generated corpus without rewriting the archive itself.
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
    out: path.join(ROOT, "reports", "generated", "latest-official-archive.jsonl"),
    manifestOut: null,
  };
  for (let index = 2; index < process.argv.length; index += 1) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (!key.startsWith("--")) continue;
    index += 1;
    if (key === "--archive-dir") args.archiveDir = path.resolve(ROOT, value);
    else if (key === "--out") args.out = path.resolve(ROOT, value);
    else if (key === "--manifest-out") args.manifestOut = path.resolve(ROOT, value);
  }
  args.manifestOut ||= args.out.replace(/\.jsonl$/i, ".manifest.json");
  return args;
}

async function listShards(archiveDir) {
  const entries = await fsp.readdir(archiveDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^matches-\d{4}-\d{2}-\d{2}(?:-[a-zA-Z0-9._-]+)?\.jsonl(\.gz)?$/.test(entry.name))
    .map((entry) => path.join(archiveDir, entry.name))
    .sort();
}

function lineReader(filePath) {
  const input = fs.createReadStream(filePath);
  const stream = filePath.endsWith(".gz") ? input.pipe(createGunzip()) : input;
  return readline.createInterface({ input: stream, crlfDelay: Infinity });
}

async function main() {
  const args = parseArgs();
  const shards = await listShards(args.archiveDir);
  if (!shards.length) throw new Error(`No archive shards found in ${path.relative(ROOT, args.archiveDir)}`);

  await fsp.mkdir(path.dirname(args.out), { recursive: true });
  await fsp.mkdir(path.dirname(args.manifestOut), { recursive: true });

  const output = fs.createWriteStream(args.out, { encoding: "utf8" });
  const write = (text) => new Promise((resolve, reject) => {
    output.write(text, (error) => (error ? reject(error) : resolve()));
  });

  let lines = 0;
  let rawLines = 0;
  let duplicatesRemoved = 0;
  let invalidKeys = 0;
  const seen = new Set();
  for (const shard of shards) {
    const rl = lineReader(shard);
    for await (const line of rl) {
      if (!line.trim()) continue;
      rawLines += 1;
      let team;
      try {
        team = JSON.parse(line);
      } catch {
        invalidKeys += 1;
        continue;
      }
      const gameId = team?.gameId;
      const teamKey = team?.teamKey;
      if (gameId === undefined || gameId === null || teamKey === undefined || teamKey === null) {
        invalidKeys += 1;
        continue;
      }
      const key = `${gameId}:${teamKey}`;
      if (seen.has(key)) {
        duplicatesRemoved += 1;
        continue;
      }
      seen.add(key);
      await write(`${line}\n`);
      lines += 1;
    }
  }

  await new Promise((resolve, reject) => {
    output.end((error) => (error ? reject(error) : resolve()));
  });

  const manifest = {
    generatedAt: new Date().toISOString(),
    archiveDir: path.relative(ROOT, args.archiveDir).replace(/\\/g, "/"),
    out: path.relative(ROOT, args.out).replace(/\\/g, "/"),
    lines,
    rawLines,
    duplicatesRemoved,
    invalidKeys,
    shardCount: shards.length,
    shards: shards.map((shard) => path.basename(shard)),
  };
  await fsp.writeFile(args.manifestOut, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(`Materialized archive corpus: ${manifest.out} (${lines} unique teams, ${shards.length} shards)`);
  console.log(`  raw=${rawLines} duplicatesRemoved=${duplicatesRemoved} invalidKeys=${invalidKeys}`);
  console.log(`Manifest: ${path.relative(ROOT, args.manifestOut).replace(/\\/g, "/")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
