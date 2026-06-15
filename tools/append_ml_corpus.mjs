/**
 * append_ml_corpus.mjs
 *
 * Append-only, UNBOUNDED ML training corpus in JSONL (one team per line).
 * Unlike the stats accumulator (a single JSON file capped to stay under Node's
 * ~512MB string limit), this grows without limit because it is read and written
 * line-by-line (streamed) — never serialized as one giant string.
 *
 * Each run appends the newly collected teams that are not already in the corpus
 * (dedup by gameId:teamKey), so the corpus holds every unique team ever seen.
 *
 * Usage:
 *   node tools/append_ml_corpus.mjs \
 *     --corpus data/ml-training/corpus.jsonl \
 *     --new    data/official-match-input-seeded.json
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function parseArgs() {
  const args = { corpus: path.join(ROOT, "data", "ml-training", "corpus.jsonl"), newFiles: [] };
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === "--corpus") args.corpus = path.resolve(ROOT, process.argv[++i]);
    else if (process.argv[i] === "--new") args.newFiles.push(path.resolve(ROOT, process.argv[++i]));
  }
  return args;
}

function keyOf(team) {
  return `${team.gameId}:${team.teamKey}`;
}

async function loadExistingKeys(corpusPath) {
  const seen = new Set();
  if (!fs.existsSync(corpusPath)) return seen;
  const rl = readline.createInterface({
    input: fs.createReadStream(corpusPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try { seen.add(keyOf(JSON.parse(line))); } catch { /* skip malformed line */ }
  }
  return seen;
}

async function readTeams(filePath) {
  try {
    const data = JSON.parse(await fsp.readFile(filePath, "utf8"));
    return Array.isArray(data.teams) ? data.teams : [];
  } catch {
    return [];
  }
}

async function main() {
  const args = parseArgs();
  await fsp.mkdir(path.dirname(args.corpus), { recursive: true });

  const seen = await loadExistingKeys(args.corpus);
  const before = seen.size;

  const ws = fs.createWriteStream(args.corpus, { flags: "a", encoding: "utf8" });
  const write = (s) => new Promise((res, rej) => ws.write(s, (e) => (e ? rej(e) : res())));

  let added = 0;
  for (const f of args.newFiles) {
    const teams = await readTeams(f);
    for (const team of teams) {
      const k = keyOf(team);
      if (seen.has(k)) continue;
      seen.add(k);
      await write(JSON.stringify(team) + "\n");
      added += 1;
    }
  }
  await new Promise((res, rej) => ws.end((e) => (e ? rej(e) : res())));

  console.log(`ML corpus: ${path.relative(ROOT, args.corpus)}`);
  console.log(`  existing ${before} + added ${added} = ${before + added} unique teams`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
