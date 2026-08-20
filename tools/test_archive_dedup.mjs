import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { normalizeGame } from "./official_collect_utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const normalized = normalizeGame(900, {
  userGames: [1, 2, 3].map((characterNum) => ({
    teamNumber: 1,
    characterNum,
    bestWeapon: 1,
    gameRank: 2,
    mmrAvg: 7600,
    preMade: characterNum,
    versionSeason: 20,
    versionMajor: 5,
    versionMinor: 1,
  })),
}, { tierBucket: "iron_gold", fineBucket: "gold", mmr: 3200 });
assert.equal(normalized[0].tierBucket, "meteor_mithril");
assert.equal(normalized[0].fineBucket, "meteor");
assert.equal(normalized[0].tierSource, "game-team-mmr");
assert.equal(normalized[0].teamMmr, 7600);
assert.equal(normalized[0].premadeSize, 3);
assert.equal(normalized[0].versionMajor, 5);

function run(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: ROOT, stdio: "pipe" });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("exit", (code) => code === 0 ? resolve(output) : reject(new Error(output)));
  });
}

const testRoot = path.join(ROOT, "reports", "generated");
await fs.mkdir(testRoot, { recursive: true });
const temporaryRoot = await fs.mkdtemp(path.join(testRoot, "archive-test-"));
try {
  const archiveDir = path.join(temporaryRoot, "archive");
  const indexPath = path.join(archiveDir, "seen-game-ids.txt");
  const firstInput = path.join(temporaryRoot, "first.json");
  const secondInput = path.join(temporaryRoot, "second.json");
  const output = path.join(temporaryRoot, "materialized.jsonl");
  const summaryPath = path.join(temporaryRoot, "summary.json");
  await fs.mkdir(archiveDir, { recursive: true });
  const team = (gameId, teamKey) => ({ gameId, teamKey, rank: Number(teamKey), players: [] });
  await fs.writeFile(firstInput, JSON.stringify({ teams: [team(100, 1), team(100, 2)] }), "utf8");
  await fs.writeFile(secondInput, JSON.stringify({ teams: [team(100, 1), team(101, 1)] }), "utf8");

  await run("tools/build_archive_seen_games.mjs", ["--archive-dir", archiveDir, "--out", indexPath]);
  await run("tools/archive_official_matches.mjs", [
    "--in", firstInput, "--archive-dir", archiveDir, "--seen-games", indexPath, "--date", "2026-08-20",
  ]);
  await run("tools/archive_official_matches.mjs", [
    "--in", secondInput, "--archive-dir", archiveDir, "--seen-games", indexPath, "--date", "2026-08-20",
  ]);
  // Legacy archive corruption simulation: append the same gzip members again.
  const shardNames = (await fs.readdir(archiveDir)).filter((name) => name.startsWith("matches-2026-08-20-") && name.endsWith(".jsonl.gz"));
  assert.equal(shardNames.length, 2);
  for (const shardName of shardNames) {
    const shardPath = path.join(archiveDir, shardName);
    await fs.appendFile(shardPath, await fs.readFile(shardPath));
  }
  await run("tools/materialize_archive_corpus.mjs", ["--archive-dir", archiveDir, "--out", output]);
  await run("tools/build_official_summary.mjs", ["--archive-dir", archiveDir, "--out", summaryPath]);

  const rows = (await fs.readFile(output, "utf8")).trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(rows.map((row) => `${row.gameId}:${row.teamKey}`), ["100:1", "100:2", "101:1"]);
  const seenGames = (await fs.readFile(indexPath, "utf8")).trim().split(/\r?\n/).sort();
  assert.deepEqual(seenGames, ["100", "101"]);
  const manifest = JSON.parse(await fs.readFile(output.replace(/\.jsonl$/, ".manifest.json"), "utf8"));
  assert.equal(manifest.rawLines, 6);
  assert.equal(manifest.duplicatesRemoved, 3);
  assert.equal(manifest.lines, 3);
  const summary = JSON.parse(await fs.readFile(summaryPath, "utf8"));
  assert.equal(summary.version, 2);
  assert.equal(summary.totals.teams, 3);
  assert.equal(summary.quality.duplicatesRemoved, 3);
  console.log("archive cross-run dedup test: passed");
} finally {
  const resolved = path.resolve(temporaryRoot);
  assert.ok(resolved.startsWith(path.resolve(testRoot) + path.sep));
  await fs.rm(resolved, { recursive: true, force: true });
}
