/**
 * Build the persistent game-id index used to prevent cross-run archive duplicates.
 *
 * The archive stores a complete lobby at collection time, so one gameId is enough
 * to reject every repeated team from that lobby. The plain-text index stays small,
 * is append-friendly in Git, and avoids rescanning the full gzip archive every run.
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
    out: null,
    force: false,
  };
  for (let index = 2; index < process.argv.length; index += 1) {
    const key = process.argv[index];
    if (key === "--force") {
      args.force = true;
      continue;
    }
    const value = process.argv[index + 1];
    if (!key.startsWith("--")) continue;
    index += 1;
    if (key === "--archive-dir") args.archiveDir = path.resolve(ROOT, value);
    else if (key === "--out") args.out = path.resolve(ROOT, value);
  }
  args.out ||= path.join(args.archiveDir, "seen-game-ids.txt");
  return args;
}

async function listShards(archiveDir) {
  const entries = await fsp.readdir(archiveDir, { withFileTypes: true }).catch(() => []);
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

async function countIndex(indexPath) {
  let count = 0;
  const rl = readline.createInterface({
    input: fs.createReadStream(indexPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) if (line.trim()) count += 1;
  return count;
}

async function main() {
  const args = parseArgs();
  if (!args.force && fs.existsSync(args.out)) {
    console.log(`Archive seen-game index ready: ${path.relative(ROOT, args.out)} (${await countIndex(args.out)} games)`);
    return;
  }

  const shards = await listShards(args.archiveDir);
  const gameIds = new Set();
  let rawLines = 0;
  let invalidLines = 0;
  for (const shard of shards) {
    const rl = lineReader(shard);
    for await (const line of rl) {
      if (!line.trim()) continue;
      rawLines += 1;
      try {
        const gameId = JSON.parse(line)?.gameId;
        if (gameId !== undefined && gameId !== null && gameId !== "") gameIds.add(String(gameId));
      } catch {
        invalidLines += 1;
      }
    }
  }

  await fsp.mkdir(path.dirname(args.out), { recursive: true });
  const temporary = `${args.out}.tmp`;
  const values = [...gameIds].sort((left, right) => Number(left) - Number(right));
  await fsp.writeFile(temporary, values.length ? `${values.join("\n")}\n` : "", "utf8");
  await fsp.rename(temporary, args.out);
  console.log(`Built archive seen-game index: ${path.relative(ROOT, args.out)}`);
  console.log(`  shards=${shards.length} rawTeams=${rawLines} uniqueGames=${values.length} invalidLines=${invalidLines}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
