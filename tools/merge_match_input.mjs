/**
 * merge_match_input.mjs
 *
 * Merges one or more match-input JSON files into a single accumulated file.
 * Teams are deduplicated by gameId:teamKey.
 *
 * Usage:
 *   node tools/merge_match_input.mjs \
 *     --accumulated data/official-match-input-accumulated.json \
 *     --new         data/official-match-input-seeded.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function parseArgs() {
  const args = { accumulated: null, newFiles: [] };
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === "--accumulated") args.accumulated = path.resolve(ROOT, process.argv[++i]);
    else if (process.argv[i] === "--new")         args.newFiles.push(path.resolve(ROOT, process.argv[++i]));
  }
  return args;
}

async function readTeams(filePath) {
  try {
    const data = JSON.parse(await fs.readFile(filePath, "utf8"));
    return Array.isArray(data.teams) ? data.teams : [];
  } catch {
    return [];
  }
}

async function main() {
  const args = parseArgs();
  if (!args.accumulated) { console.error("--accumulated required"); process.exit(1); }

  // Load existing accumulated data
  let existing = [];
  let meta = { generatedAt: new Date().toISOString(), source: "official-api-accumulated" };
  try {
    const raw = JSON.parse(await fs.readFile(args.accumulated, "utf8"));
    existing = raw.teams ?? [];
    meta = { ...raw, teams: undefined };
    console.log(`Loaded accumulated: ${existing.length} teams`);
  } catch {
    console.log("No existing accumulated file — starting fresh.");
  }

  // Load new files
  let newTeams = [];
  for (const f of args.newFiles) {
    const teams = await readTeams(f);
    console.log(`Loaded new file ${path.relative(ROOT, f)}: ${teams.length} teams`);
    newTeams = newTeams.concat(teams);
  }

  // Merge with dedup by gameId:teamKey
  const seen = new Map();
  for (const t of existing)  { const k = `${t.gameId}:${t.teamKey}`; if (!seen.has(k)) seen.set(k, t); }
  for (const t of newTeams)  { const k = `${t.gameId}:${t.teamKey}`; if (!seen.has(k)) seen.set(k, t); }

  const merged = [...seen.values()];
  console.log(`Merged: ${merged.length} teams (added ${merged.length - existing.length} new)`);

  // Write
  await fs.mkdir(path.dirname(args.accumulated), { recursive: true });
  await fs.writeFile(args.accumulated, JSON.stringify({
    ...meta,
    generatedAt: new Date().toISOString(),
    totalTeams: merged.length,
    teams: merged,
  }, null, 2), "utf8");
  console.log(`Saved: ${path.relative(ROOT, args.accumulated)}`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
