/**
 * Build a compact official stats JSON from the large officialMatchStats JSON.
 *
 * The compact bundle keeps the shape consumed by app/recommender code, while
 * dropping large distribution arrays that are not used at runtime.
 *
 * Usage:
 *   node tools/build_compact_stats.mjs
 *   node tools/build_compact_stats.mjs --in <path> --out <path> [--pretty]
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
  };
  for (let index = 2; index < process.argv.length; index += 1) {
    const key = process.argv[index];
    if (key === "--pretty") {
      args.pretty = true;
      continue;
    }
    const value = process.argv[index + 1];
    if (!key.startsWith("--")) continue;
    index += 1;
    if (key === "--in") args.in = path.resolve(ROOT, value);
    else if (key === "--out") args.out = path.resolve(ROOT, value);
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

async function main() {
  const args = parseArgs();
  if (!fs.existsSync(args.in)) {
    throw new Error(`Input not found: ${path.relative(ROOT, args.in)}`);
  }

  const raw = await fsp.readFile(args.in);
  const data = JSON.parse(raw.toString("utf8"));
  const compact = stripUnusedRuntimeFields(data);
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
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
