/**
 * Build lobby-controlled pair synergy lift from official match JSONL.
 *
 * The model is intentionally simple:
 * - Estimate each character/variant marginal average placement.
 * - For each team, expected placement = mean(member marginal placements).
 * - residual = actual placement - expected placement.
 * - Pair lift = -mean(residual | pair appears), so positive is better than marginal baseline.
 * - Use a normal approximation and Benjamini-Hochberg FDR to keep only significant pairs.
 *
 * Usage:
 *   node tools/pair_synergy_lift.mjs --data "C:/.../matches-current.jsonl" --out src/pairSynergyLift.js
 *   node tools/pair_synergy_lift.mjs --data "C:/.../matches-current.jsonl" --by variant --min 30 --fdr 0.10
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { FALLBACK_CHARACTER_CODE_TO_ID as CHARACTER_CODE_TO_ID } from "./character_code_map.mjs";

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
};

const DATA = opt("--data", null);
const BY = opt("--by", "char");
const MIN = Number(opt("--min", 40));
const FDR = Number(opt("--fdr", 0.10));
const TOP = Number(opt("--top", 25));
// The corpus is written oldest-shard-first, so a scan cap does not sample the
// data - it takes the oldest slice of it. The 2026-06 build read the first
// 200k lines and shipped a model of whatever season those happened to be.
const SCAN = Number(opt("--scan", Infinity));
// Ranked only, matching the policy build_official_stats.mjs applies. Normal games
// are half the archive and are not the games this app is used for.
const MATCHING_MODE = opt("--matching-mode", "3") === "any" ? null : Number(opt("--matching-mode", "3"));
// Pair lift is a per-patch quantity; unlike the stats build there is no season
// weighting here, so old seasons have to be dropped outright. "current" resolves
// to the highest seasonId in the input rather than a number someone has to
// remember to bump - that is exactly how this file went stale the first time.
const MIN_SEASON_ARG = opt("--min-season", "current");
const MIN_SEASON = MIN_SEASON_ARG === "any" ? null
  : MIN_SEASON_ARG === "current" ? "current"
  : Number(MIN_SEASON_ARG);
const TEAM_TIER = opt("--team-tier", null);
const OUT = opt("--out", null);
const TEAM_TIER_SET = TEAM_TIER ? new Set(TEAM_TIER.split(",").map((value) => value.trim()).filter(Boolean)) : null;

if (!DATA || !fs.existsSync(DATA)) {
  console.error("Missing --data <matches.jsonl>.");
  process.exit(1);
}

function keyOf(member) {
  return BY === "variant" ? member.variantId : member.characterId;
}

// The archive schema moved. The 2026-06 build read `members[].characterId` and
// `result.placement`; shards written since carry `players[].character` (the
// official numeric code) and a top-level `rank`. Against the current corpus the
// old reader matched nothing and reported "teams=0" without failing, which is why
// src/pairSynergyLift.js stayed frozen at its June contents. Read both shapes.
function teamShape(team) {
  if (Array.isArray(team.members) && team.members.length === 3) {
    const placement = team.result?.placement;
    if (placement == null) return null;
    if (!team.members.every((member) => member?.variantId && member?.characterId)) return null;
    return { keys: team.members.map(keyOf), placement };
  }
  if (Array.isArray(team.players) && team.players.length === 3) {
    const placement = team.rank;
    if (placement == null) return null;
    if (BY === "variant") throw new Error("--by variant is not supported on the players schema (no local variant ids)");
    const keys = team.players.map((player) => CHARACTER_CODE_TO_ID[String(player?.character)]);
    if (keys.some((key) => !key)) return null;
    return { keys, placement };
  }
  return null;
}

function pairKey(a, b) {
  return [a, b].sort().join("|");
}

function pushMapArray(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function meanStd(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / ((values.length - 1) || 1);
  return [mean, Math.sqrt(variance)];
}

function pTwoSidedNormal(zValue) {
  const z = Math.abs(zValue);
  const t = 1 / (1 + 0.2316419 * z);
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const tail = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return 2 * tail;
}

async function readTeams() {
  // 1차: 로비(gameId)별 팀과 크기 수집. 같은 게임의 모든 팀이 한 로비를 이룬다(7~8팀).
  const rawTeams = [];
  const lobbySize = new Map();
  const rl = readline.createInterface({ input: fs.createReadStream(DATA), crlfDelay: Infinity });
  let scanned = 0;
  const dropped = { matchingMode: 0, season: 0, shape: 0 };

  for await (const line of rl) {
    if (++scanned > SCAN) break;
    if (!line) continue;
    let team;
    try {
      team = JSON.parse(line);
    } catch {
      continue;
    }

    if (TEAM_TIER_SET && !TEAM_TIER_SET.has(team.tierBucket)) continue;
    if (MATCHING_MODE !== null && team.matchingMode !== undefined
        && team.matchingMode !== MATCHING_MODE) { dropped.matchingMode += 1; continue; }
    if (typeof MIN_SEASON === "number" && Number.isFinite(team.seasonId)
        && team.seasonId < MIN_SEASON) { dropped.season += 1; continue; }

    const shape = teamShape(team);
    if (!shape) { dropped.shape += 1; continue; }
    const { keys, placement } = shape;
    if (new Set(keys).size !== 3) continue;
    const gameId = String(team.gameId ?? "");
    rawTeams.push({ keys, placement, gameId, seasonId: team.seasonId });
    if (gameId) lobbySize.set(gameId, (lobbySize.get(gameId) ?? 0) + 1);
  }

  // "current" can only be known once the whole input has been seen. Resolving it
  // here keeps this to a single pass over a multi-GB corpus.
  let resolvedSeason = typeof MIN_SEASON === "number" ? MIN_SEASON : null;
  if (MIN_SEASON === "current") {
    // Spreading hundreds of thousands of arguments into Math.max blows the stack.
    for (const raw of rawTeams) {
      if (Number.isFinite(raw.seasonId) && raw.seasonId > 0 && raw.seasonId > (resolvedSeason ?? 0)) {
        resolvedSeason = raw.seasonId;
      }
    }
    if (resolvedSeason !== null) {
      const kept = rawTeams.filter((raw) => !Number.isFinite(raw.seasonId) || raw.seasonId >= resolvedSeason);
      dropped.season += rawTeams.length - kept.length;
      // Spreading 500k+ elements into push blows the stack the same way Math.max does.
      rawTeams.length = 0;
      for (const raw of kept) rawTeams.push(raw);
      // Lobby sizes were counted before the season filter; recount so the
      // placement normalisation still reflects the teams we actually keep.
      lobbySize.clear();
      for (const raw of kept) if (raw.gameId) lobbySize.set(raw.gameId, (lobbySize.get(raw.gameId) ?? 0) + 1);
    }
  }

  // 2차: 로비 크기로 placement를 8팀 스케일(1..8)로 정규화 → 7팀/8팀 로비를 일관 비교.
  // lift 단위는 여전히 "등(8팀 기준)"이라 recommender의 페어 가중치 가정이 유지된다.
  const teams = [];
  const marginalSum = new Map();
  const marginalCount = new Map();
  for (const raw of rawTeams) {
    const size = lobbySize.get(raw.gameId) ?? 8;
    const norm = size > 1 ? 1 + ((raw.placement - 1) / (size - 1)) * 7 : raw.placement;
    teams.push({ keys: raw.keys, placement: norm });
    for (const key of raw.keys) {
      marginalSum.set(key, (marginalSum.get(key) ?? 0) + norm);
      marginalCount.set(key, (marginalCount.get(key) ?? 0) + 1);
    }
  }

  const marginal = new Map();
  for (const [key, sum] of marginalSum) {
    marginal.set(key, sum / marginalCount.get(key));
  }

  return { teams, marginal, scanned: Math.min(scanned, SCAN), dropped, resolvedSeason };
}

function buildRows(teams, marginal) {
  const residualsByPair = new Map();
  for (const team of teams) {
    const expected = team.keys.reduce((sum, key) => sum + marginal.get(key), 0) / team.keys.length;
    const residual = team.placement - expected;
    const [a, b, c] = team.keys;
    pushMapArray(residualsByPair, pairKey(a, b), residual);
    pushMapArray(residualsByPair, pairKey(a, c), residual);
    pushMapArray(residualsByPair, pairKey(b, c), residual);
  }

  const rows = [];
  for (const [key, residuals] of residualsByPair) {
    if (residuals.length < MIN) continue;
    const [mean, std] = meanStd(residuals);
    const se = std / Math.sqrt(residuals.length);
    if (!Number.isFinite(se) || se === 0) continue;
    const z = mean / se;
    rows.push({
      key,
      n: residuals.length,
      lift: -mean,
      z,
      p: pTwoSidedNormal(z),
    });
  }

  rows.sort((a, b) => a.p - b.p);
  let threshold = 0;
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index].p <= ((index + 1) / rows.length) * FDR) threshold = rows[index].p;
  }

  for (const row of rows) row.significant = row.p <= threshold;
  return rows;
}

function formatRow(row) {
  const lift = `${row.lift >= 0 ? "+" : ""}${row.lift.toFixed(3)}`;
  return `${row.key.padEnd(BY === "variant" ? 36 : 24)} lift=${lift}  n=${String(row.n).padStart(5)}  z=${row.z.toFixed(1)}`;
}

function writeModule(outPath, rows, meta) {
  const significant = rows
    .filter((row) => row.significant)
    .sort((a, b) => Math.abs(b.lift) - Math.abs(a.lift));
  const entries = Object.fromEntries(significant.map((row) => [
    row.key,
    {
      lift: Number(row.lift.toFixed(4)),
      n: row.n,
      z: Number(row.z.toFixed(3)),
    },
  ]));

  const content = `// Generated by tools/pair_synergy_lift.mjs. Do not edit by hand.\n` +
    `export const pairSynergyLiftMeta = ${JSON.stringify(meta, null, 2)};\n\n` +
    `export const officialPairSynergyLift = ${JSON.stringify(entries, null, 2)};\n`;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, content);
}

const { teams, marginal, scanned, dropped, resolvedSeason } = await readTeams();
console.error(`scanned ${scanned} lines | kept ${teams.length} teams | dropped ${dropped.matchingMode} unranked, ${dropped.season} old-season, ${dropped.shape} unreadable`);

// Reading nothing used to produce a valid-looking file with zero pairs. Refuse,
// so a schema change fails the build instead of quietly freezing the model.
if (teams.length === 0) {
  console.error("No teams read - check --matching-mode/--min-season and the input schema.");
  process.exit(1);
}
const rows = buildRows(teams, marginal);
const significant = rows.filter((row) => row.significant);
const synergy = significant.filter((row) => row.lift > 0).sort((a, b) => b.lift - a.lift);
const antiSynergy = significant.filter((row) => row.lift < 0).sort((a, b) => a.lift - b.lift);

const meta = {
  generatedAt: new Date().toISOString(),
  source: path.basename(DATA),
  by: BY,
  minSamples: MIN,
  fdr: FDR,
  scanLimit: SCAN,
  matchingMode: MATCHING_MODE,
  minSeason: resolvedSeason,
  scanned,
  teams: teams.length,
  pairs: rows.length,
  significantPairs: significant.length,
  teamTier: TEAM_TIER ?? "all",
};

console.log(`# pair synergy lift by=${BY} teams=${teams.length} pairs(>=${MIN})=${rows.length} significant=${significant.length}`);
console.log(`# lift: positive means better placement than member marginal baseline. FDR=${FDR}`);
console.log(`\nPositive synergy top ${Math.min(TOP, synergy.length)}`);
for (const row of synergy.slice(0, TOP)) console.log(`  ${formatRow(row)}`);
console.log(`\nAnti-synergy top ${Math.min(TOP, antiSynergy.length)}`);
for (const row of antiSynergy.slice(0, TOP)) console.log(`  ${formatRow(row)}`);

if (OUT) {
  writeModule(path.resolve(OUT), rows, meta);
  console.log(`\nWrote ${OUT}`);
}
