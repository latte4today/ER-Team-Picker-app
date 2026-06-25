/**
 * Validate the generated pair synergy lift module without regenerating it.
 *
 * This is intentionally read-only: it checks the published table contract so
 * noisy pair data cannot silently enter the recommender.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
};

const file = opt("--file", "src/pairSynergyLift.js");
const minSamplesArg = opt("--min", null);
const maxFdrArg = opt("--max-fdr", null);
const absolutePath = path.resolve(file);

let module;
try {
  module = await import(pathToFileURL(absolutePath).href);
} catch (error) {
  console.error(`# pair synergy check failed: cannot import ${file}`);
  console.error(error?.message ?? error);
  process.exit(1);
}

const meta = module.pairSynergyLiftMeta ?? {};
const table = module.officialPairSynergyLift ?? {};
const minSamples = minSamplesArg == null ? Number(meta.minSamples ?? 0) : Number(minSamplesArg);
const maxFdr = maxFdrArg == null ? Number(meta.fdr ?? 1) : Number(maxFdrArg);
const errors = [];

if (!Number.isFinite(minSamples) || minSamples <= 0) {
  errors.push(`invalid minSamples: ${meta.minSamples}`);
}

if (!Number.isFinite(maxFdr) || maxFdr <= 0 || maxFdr > 1) {
  errors.push(`invalid fdr: ${meta.fdr}`);
}

if (Number(meta.minSamples ?? 0) < minSamples) {
  errors.push(`meta.minSamples ${meta.minSamples} is lower than required ${minSamples}`);
}

if (Number(meta.fdr ?? 1) > maxFdr) {
  errors.push(`meta.fdr ${meta.fdr} is higher than allowed ${maxFdr}`);
}

let rows = 0;
let positive = 0;
let negative = 0;
for (const [key, row] of Object.entries(table)) {
  rows += 1;
  if (!/^[^|]+\|[^|]+$/.test(key)) errors.push(`invalid pair key: ${key}`);
  if (!Number.isFinite(row.lift)) errors.push(`${key}: invalid lift`);
  if (!Number.isFinite(row.z)) errors.push(`${key}: invalid z`);
  if (!Number.isInteger(row.n) || row.n < minSamples) {
    errors.push(`${key}: n=${row.n} below minSamples=${minSamples}`);
  }
  if (row.lift > 0) positive += 1;
  if (row.lift < 0) negative += 1;
}

if (!rows) errors.push("officialPairSynergyLift is empty");
if (Number(meta.significantPairs ?? rows) !== rows) {
  errors.push(`meta.significantPairs=${meta.significantPairs} does not match rows=${rows}`);
}

if (errors.length) {
  console.error(`# pair synergy check failed (${errors.length} issues)`);
  for (const error of errors.slice(0, 25)) console.error(`- ${error}`);
  if (errors.length > 25) console.error(`- ... ${errors.length - 25} more`);
  process.exit(1);
}

console.log(`# pair synergy check passed: rows=${rows} positive=${positive} negative=${negative} minSamples=${minSamples} fdr<=${maxFdr}`);
console.log(`# source=${meta.source ?? "unknown"} generatedAt=${meta.generatedAt ?? "unknown"}`);
