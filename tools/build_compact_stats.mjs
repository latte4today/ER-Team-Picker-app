/**
 * Build a compact official stats JSON from the large officialMatchStats JSON.
 *
 * The compact bundle keeps the shape consumed by app/recommender code, while
 * dropping large distribution arrays that are not used at runtime.
 *
 * Usage:
 *   node tools/build_compact_stats.mjs
 *   node tools/build_compact_stats.mjs --in <path> --out <path> [--pretty]
 *   node tools/build_compact_stats.mjs --composition-min-games 20 --round-rates 3
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function parseArgs() {
  const args = {
    in: path.join(ROOT, "src", "officialMatchStats.json"),
    out: path.join(ROOT, "reports", "generated", "officialMatchStats.compact.json"),
    pretty: false,
    dropComposition: false,
    compositionMinGames: 0,
    pairMinGames: 0,
    traitBuildMinGames: 0,
    candidateMinGames: 0,
    combatMinGames: 0,
    roundRates: undefined,
    roundAverages: undefined,
  };
  for (let index = 2; index < process.argv.length; index += 1) {
    const key = process.argv[index];
    if (key === "--pretty") {
      args.pretty = true;
      continue;
    }
    if (key === "--drop-composition") {
      args.dropComposition = true;
      continue;
    }
    const value = process.argv[index + 1];
    if (!key.startsWith("--")) continue;
    index += 1;
    if (key === "--in") args.in = path.resolve(ROOT, value);
    else if (key === "--out") args.out = path.resolve(ROOT, value);
    else if (key === "--composition-min-games") args.compositionMinGames = Number(value);
    else if (key === "--pair-min-games") args.pairMinGames = Number(value);
    else if (key === "--trait-build-min-games") args.traitBuildMinGames = Number(value);
    else if (key === "--candidate-min-games") args.candidateMinGames = Number(value);
    else if (key === "--combat-min-games") args.combatMinGames = Number(value);
    else if (key === "--round-rates") args.roundRates = Number(value);
    else if (key === "--round-averages") args.roundAverages = Number(value);
  }
  return args;
}

const DROP_KEYS = new Set(["firstSubTraits", "secondSubTraits", "tacticalSkills"]);

function stripUnusedRuntimeFields(value) {
  if (Array.isArray(value)) return value.map(stripUnusedRuntimeFields);
  if (!value || typeof value !== "object") return value;

  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (DROP_KEYS.has(key)) continue;
    output[key] = stripUnusedRuntimeFields(child);
  }
  return output;
}

function minGames(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function countRows(value) {
  if (!value) return 0;
  if (Array.isArray(value)) return value.length;
  if (typeof value === "object") return Object.keys(value).length;
  return 0;
}

function countBucketRows(section) {
  if (!section || typeof section !== "object") return 0;
  return Object.values(section).reduce((sum, bucket) => sum + countRows(bucket), 0);
}

function filterObjectByGames(object, threshold) {
  if (!threshold || !object || typeof object !== "object") return object;
  return Object.fromEntries(
    Object.entries(object).filter(([, row]) => Number(row?.games || 0) >= threshold),
  );
}

function filterArrayByGames(rows, threshold) {
  if (!threshold || !Array.isArray(rows)) return rows;
  return rows.filter((row) => Number(row?.games || 0) >= threshold);
}

function filterNestedTraitBuildByGames(section, threshold) {
  if (!threshold || !section || typeof section !== "object") return section;
  const output = {};
  for (const [bucket, byVariant] of Object.entries(section)) {
    const nextByVariant = {};
    for (const [variantId, rows] of Object.entries(byVariant || {})) {
      const filtered = filterArrayByGames(rows, threshold);
      if (filtered.length) nextByVariant[variantId] = filtered;
    }
    output[bucket] = nextByVariant;
  }
  return output;
}

function filterBucketObjectsByGames(section, threshold) {
  if (!threshold || !section || typeof section !== "object") return section;
  const output = {};
  for (const [bucket, rows] of Object.entries(section)) {
    output[bucket] = filterObjectByGames(rows, threshold);
  }
  return output;
}

function filterBucketArraysByGames(section, threshold) {
  if (!threshold || !section || typeof section !== "object") return section;
  const output = {};
  for (const [bucket, rows] of Object.entries(section)) {
    output[bucket] = filterArrayByGames(rows, threshold);
  }
  return output;
}

function roundNumber(value, digits) {
  if (!Number.isFinite(value) || !Number.isFinite(digits) || digits < 0) return value;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function shouldRoundRateKey(key) {
  return /(?:Rate|Share|Participation)$/i.test(key);
}

function shouldRoundAverageKey(key) {
  return /^(?:avg|average)/i.test(key);
}

function roundStats(value, options) {
  if (Array.isArray(value)) return value.map((item) => roundStats(item, options));
  if (!value || typeof value !== "object") return value;

  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "number" && shouldRoundRateKey(key)) {
      output[key] = roundNumber(child, options.roundRates);
    } else if (typeof child === "number" && shouldRoundAverageKey(key)) {
      output[key] = roundNumber(child, options.roundAverages);
    } else {
      output[key] = roundStats(child, options);
    }
  }
  return output;
}

function applyTrimOptions(compact, args) {
  const options = {
    compositionMinGames: minGames(args.compositionMinGames),
    pairMinGames: minGames(args.pairMinGames),
    traitBuildMinGames: minGames(args.traitBuildMinGames),
    candidateMinGames: minGames(args.candidateMinGames),
    combatMinGames: minGames(args.combatMinGames),
    roundRates: Number.isFinite(args.roundRates) ? args.roundRates : undefined,
    roundAverages: Number.isFinite(args.roundAverages) ? args.roundAverages : undefined,
  };

  const output = { ...compact };
  if (args.dropComposition) {
    output.officialCompositionStatsByTier = {};
  } else {
    output.officialCompositionStatsByTier = filterBucketArraysByGames(
      output.officialCompositionStatsByTier,
      options.compositionMinGames,
    );
  }
  output.officialPairStatsByTier = filterBucketObjectsByGames(output.officialPairStatsByTier, options.pairMinGames);
  output.officialTraitBuildStatsByTier = filterNestedTraitBuildByGames(
    output.officialTraitBuildStatsByTier,
    options.traitBuildMinGames,
  );
  output.officialCandidateStatsByTier = filterBucketObjectsByGames(
    output.officialCandidateStatsByTier,
    options.candidateMinGames,
  );
  output.officialCombatStatsByTier = filterBucketObjectsByGames(output.officialCombatStatsByTier, options.combatMinGames);

  if (options.roundRates !== undefined || options.roundAverages !== undefined) {
    return roundStats(output, options);
  }
  return output;
}

function sectionCounts(payload) {
  return {
    composition: countBucketRows(payload.officialCompositionStatsByTier),
    pair: countBucketRows(payload.officialPairStatsByTier),
    traitBuild: Object.values(payload.officialTraitBuildStatsByTier || {})
      .reduce((sum, bucket) => sum + Object.values(bucket || {}).reduce((inner, rows) => inner + countRows(rows), 0), 0),
    candidate: countBucketRows(payload.officialCandidateStatsByTier),
    combat: countBucketRows(payload.officialCombatStatsByTier),
  };
}

async function main() {
  const args = parseArgs();
  if (!fs.existsSync(args.in)) {
    throw new Error(`Input not found: ${path.relative(ROOT, args.in)}`);
  }

  const raw = await fsp.readFile(args.in);
  const data = JSON.parse(raw.toString("utf8"));
  const stripped = stripUnusedRuntimeFields(data);
  const beforeCounts = sectionCounts(stripped);
  const compact = applyTrimOptions(stripped, args);
  const afterCounts = sectionCounts(compact);
  const output = args.pretty
    ? `${JSON.stringify(compact, null, 2)}\n`
    : JSON.stringify(compact);

  await fsp.mkdir(path.dirname(args.out), { recursive: true });
  await fsp.writeFile(args.out, output, "utf8");

  const inBytes = raw.length;
  const outBytes = Buffer.byteLength(output);
  const savedPct = inBytes ? Math.round(100 * (1 - outBytes / inBytes)) : 0;
  console.log("Compact official stats written");
  console.log(`  in:  ${path.relative(ROOT, args.in)} (${(inBytes / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`  out: ${path.relative(ROOT, args.out)} (${(outBytes / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`  saved: ${savedPct}%`);
  console.log(`  dropped keys: ${[...DROP_KEYS].join(", ")}`);
  console.log(`  rows: ${JSON.stringify({ before: beforeCounts, after: afterCounts })}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
