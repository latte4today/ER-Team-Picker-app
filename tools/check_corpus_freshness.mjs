/**
 * check_corpus_freshness.mjs — does the ML corpus still cover the durable archive?
 *
 * The collect-seeds workflow only re-materialised the corpus when the file was
 * missing entirely. Anything added to the archive out of band - the 24 dedup
 * shards backfilled on 2026-08-21, 1.8M teams - never reached a cached corpus,
 * because `append_ml_corpus.mjs` only ever appends the teams *this run* collected.
 * A non-empty but stale corpus therefore stayed stale forever, and the stats built
 * from it covered a third of the data we hold. That is how pair-role coverage
 * arrived at 815 rows (2 for meteor_mithril, 0 for demigod_eternity) off 442,940
 * teams, when the archive supports 5,032 rows off 1,389,762.
 *
 * So: compare the corpus line count against the team totals the archive manifest
 * reports. Behind by more than the tolerance, exit 1 and let the caller rebuild.
 *
 * Exit 0 = corpus covers the archive (or there is nothing to compare against).
 * Exit 1 = corpus is behind; re-materialise it.
 *
 * Usage:
 *   node tools/check_corpus_freshness.mjs --archive-dir data-repo/official-archive
 *   node tools/check_corpus_freshness.mjs --corpus data/ml-training/corpus.jsonl --tolerance 0.98
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs() {
  const args = {
    archiveDir: path.join(ROOT, "data", "official-archive"),
    corpus: path.join(ROOT, "data", "ml-training", "corpus.jsonl"),
    // The corpus legitimately runs a little behind: the shard this run archives is
    // counted by the manifest before the next run's materialise. A couple of
    // percent is normal; a third of the data missing is not.
    tolerance: 0.97,
  };
  for (let i = 2; i < process.argv.length; i += 1) {
    const key = process.argv[i];
    if (!key.startsWith("--")) continue;
    const value = process.argv[i + 1];
    i += 1;
    if (key === "--archive-dir") args.archiveDir = path.resolve(ROOT, value);
    else if (key === "--corpus") args.corpus = path.resolve(ROOT, value);
    else if (key === "--tolerance") args.tolerance = Number(value);
  }
  return args;
}

/** Count newlines without ever holding the file - the corpus runs to several GB. */
async function countLines(filePath) {
  return new Promise((resolve, reject) => {
    let lines = 0;
    let sawTrailingByte = false;
    const stream = fs.createReadStream(filePath, { highWaterMark: 1 << 22 });
    stream.on("data", (chunk) => {
      for (let i = 0; i < chunk.length; i += 1) if (chunk[i] === 0x0a) lines += 1;
      sawTrailingByte = chunk.length > 0 && chunk[chunk.length - 1] !== 0x0a;
    });
    stream.on("end", () => resolve(lines + (sawTrailingByte ? 1 : 0)));
    stream.on("error", reject);
  });
}

async function main() {
  const args = parseArgs();
  const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");
  const manifestPath = path.join(args.archiveDir, "manifest.json");

  let manifest;
  try {
    manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
  } catch {
    // No archive to compare against - a first run, or the token-less fallback path.
    // Only a missing corpus is actionable here.
    if (!fs.existsSync(args.corpus) || (await fsp.stat(args.corpus)).size === 0) {
      console.log(`stale: no ${rel(manifestPath)} and no corpus at ${rel(args.corpus)}`);
      process.exit(1);
    }
    console.log(`skip: no ${rel(manifestPath)} to compare against; leaving the corpus alone`);
    return;
  }

  const shards = Object.values(manifest.shards ?? {});
  const archiveTeams = shards.reduce((sum, shard) => sum + (shard.teams ?? 0), 0);
  if (!archiveTeams) {
    console.log(`skip: ${rel(manifestPath)} reports no teams across ${shards.length} shards`);
    return;
  }

  if (!fs.existsSync(args.corpus) || (await fsp.stat(args.corpus)).size === 0) {
    console.log(`stale: corpus missing or empty, archive holds ${archiveTeams} teams in ${shards.length} shards`);
    process.exit(1);
  }

  const corpusLines = await countLines(args.corpus);
  const coverage = corpusLines / archiveTeams;
  const summary = `corpus ${corpusLines} / archive ${archiveTeams} teams `
    + `(${(coverage * 100).toFixed(1)}%, ${shards.length} shards)`;

  if (coverage < args.tolerance) {
    console.log(`stale: ${summary}, below the ${(args.tolerance * 100).toFixed(0)}% tolerance`);
    process.exit(1);
  }
  console.log(`fresh: ${summary}`);
}

main().catch((error) => {
  // Never let a bad read block collection; a rebuild is always the safe answer.
  console.error(`${error.message} - treating the corpus as stale`);
  process.exit(1);
});
