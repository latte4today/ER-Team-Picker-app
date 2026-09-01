import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { characterVariants, characters } from "../src/data.js";
import { characterVector } from "../src/recommender.js";
import { FALLBACK_CHARACTER_CODE_TO_ID as CHARACTER_CODE_TO_ID } from "./character_code_map.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ARTIFACT_ROOT = "C:/Users/WIN11/Desktop/ER/collected-official-data";
const DEFAULT_IN = path.join(ARTIFACT_ROOT, "data", "ml-training", "corpus.jsonl");
const DEFAULT_STATS = path.join(ARTIFACT_ROOT, "src", "officialMatchStats.json");
const DEFAULT_OUT_DIR = path.join(ROOT, "reports");
const AXES = ["frontline", "damage", "durability", "cc", "support", "sustain", "tempo", "stability"];


function parseArgs() {
  const args = { in: DEFAULT_IN, stats: DEFAULT_STATS, outDir: DEFAULT_OUT_DIR, minGames: 80, top: 30 };
  for (let i = 2; i < process.argv.length; i += 1) {
    const key = process.argv[i];
    if (!key.startsWith("--")) continue;
    const value = process.argv[i + 1];
    i += 1;
    if (key === "--in") args.in = path.resolve(value);
    if (key === "--stats") args.stats = path.resolve(value);
    if (key === "--out-dir") args.outDir = path.resolve(value);
    if (key === "--min-games") args.minGames = Number(value);
    if (key === "--top") args.top = Number(value);
  }
  return args;
}

function numeric(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function clamp(value, min = 0, max = 1.3) {
  return Math.max(min, Math.min(max, value));
}

function div(a, b, fallback = 0) {
  return b ? a / b : fallback;
}

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round((Number(value) || 0) * scale) / scale;
}

function statKey(variantId, core = null) {
  return core ? `${variantId}#${core}` : variantId;
}

function newAgg() {
  return {
    games: 0,
    wins: 0,
    top3: 0,
    rankSum: 0,
    damageToPlayer: 0,
    damageFromPlayer: 0,
    ccTime: 0,
    ccCount: 0,
    healAmount: 0,
    protectAbsorb: 0,
    kills: 0,
    assists: 0,
    teamKills: 0,
    basicDamage: 0,
    skillDamage: 0,
  };
}

function addAgg(agg, team, player) {
  const stats = player.stats ?? {};
  const rank = numeric(team.rank ?? player.gameRank);
  agg.games += 1;
  agg.wins += rank === 1 ? 1 : 0;
  agg.top3 += rank > 0 && rank <= 3 ? 1 : 0;
  agg.rankSum += rank;
  agg.damageToPlayer += numeric(stats.damageToPlayer);
  agg.damageFromPlayer += numeric(stats.damageFromPlayer);
  agg.ccTime += numeric(stats.ccTime);
  agg.ccCount += numeric(stats.ccCount);
  agg.healAmount += numeric(stats.healAmount);
  agg.protectAbsorb += numeric(stats.protectAbsorb);
  agg.kills += numeric(stats.kills);
  agg.assists += numeric(stats.assists);
  agg.teamKills += numeric(stats.teamKills);
  agg.basicDamage += numeric(stats.damageToPlayerBasic);
  agg.skillDamage += numeric(stats.damageToPlayerSkill);
}

function addToMap(map, key, team, player) {
  if (!key) return;
  if (!map.has(key)) map.set(key, newAgg());
  addAgg(map.get(key), team, player);
}

async function* readTeams(inputPath) {
  if (inputPath.endsWith(".jsonl")) {
    const rl = readline.createInterface({ input: createReadStream(inputPath), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      yield JSON.parse(line);
    }
    return;
  }

  const payload = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const teams = Array.isArray(payload) ? payload : payload.teams ?? [];
  for (const team of teams) yield team;
}

const variantsByCharacter = characterVariants.reduce((map, variant) => {
  if (!map.has(variant.characterId)) map.set(variant.characterId, []);
  map.get(variant.characterId).push(variant);
  return map;
}, new Map());

function inferWeaponMapFromSingleVariant(team, weaponCounts) {
  for (const player of team.players ?? []) {
    const characterId = CHARACTER_CODE_TO_ID[String(player.character)];
    const weaponCode = player.weapon;
    if (!characterId || weaponCode === undefined || weaponCode === null) continue;
    const variants = variantsByCharacter.get(characterId) ?? [];
    if (variants.length !== 1) continue;
    const weapon = variants[0].weapon;
    const key = String(weaponCode);
    if (!weaponCounts.has(key)) weaponCounts.set(key, new Map());
    const counts = weaponCounts.get(key);
    counts.set(weapon, (counts.get(weapon) ?? 0) + 1);
  }
}

async function inferWeaponCodeToId(inputPath) {
  const weaponCounts = new Map();
  for await (const team of readTeams(inputPath)) inferWeaponMapFromSingleVariant(team, weaponCounts);
  return new Map([...weaponCounts.entries()].map(([code, counts]) => {
    const [weapon] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    return [code, weapon];
  }).filter(([, weapon]) => weapon));
}

function variantForPlayer(player, weaponCodeToId) {
  const characterId = CHARACTER_CODE_TO_ID[String(player.character)];
  if (!characterId) return undefined;
  const variants = variantsByCharacter.get(characterId) ?? [];
  if (variants.length === 1) return variants[0];
  const weapon = weaponCodeToId.get(String(player.weapon));
  return weapon ? variants.find((variant) => variant.weapon === weapon) : undefined;
}

function averageAgg(agg) {
  return {
    games: agg.games,
    winRate: div(agg.wins, agg.games),
    top3Rate: div(agg.top3, agg.games),
    avgPlacement: div(agg.rankSum, agg.games),
    avgDamageToPlayer: div(agg.damageToPlayer, agg.games),
    avgDamageFromPlayer: div(agg.damageFromPlayer, agg.games),
    avgCcTime: div(agg.ccTime, agg.games),
    avgCcCount: div(agg.ccCount, agg.games),
    avgHealAmount: div(agg.healAmount, agg.games),
    avgProtectAbsorb: div(agg.protectAbsorb, agg.games),
    avgKills: div(agg.kills, agg.games),
    avgAssists: div(agg.assists, agg.games),
    avgTeamKills: div(agg.teamKills, agg.games),
    killParticipation: div(agg.kills + agg.assists, Math.max(1, agg.teamKills)),
    basicDamageShare: div(agg.basicDamage, Math.max(1, agg.damageToPlayer)),
    skillDamageShare: div(agg.skillDamage, Math.max(1, agg.damageToPlayer)),
  };
}

function empiricalVector(avg, globalAvg, variant) {
  const damageRatio = div(avg.avgDamageToPlayer, globalAvg.avgDamageToPlayer, 1);
  const takenRatio = div(avg.avgDamageFromPlayer, globalAvg.avgDamageFromPlayer, 1);
  const ccRatio = div(avg.avgCcTime, globalAvg.avgCcTime, 1);
  const healRatio = div(avg.avgHealAmount, globalAvg.avgHealAmount, 1);
  const protectRatio = div(avg.avgProtectAbsorb, globalAvg.avgProtectAbsorb, 1);
  const tempoRatio = div(avg.killParticipation, globalAvg.killParticipation, 1);
  const stabilityRatio = (div(avg.top3Rate, globalAvg.top3Rate, 1) + div(globalAvg.avgPlacement, avg.avgPlacement, 1)) / 2;
  const melee = variant?.weaponRange === "melee" ? 0.12 : 0;
  const frontRole = ["frontline", "bruiser"].includes(variant?.role) ? 0.12 : 0;
  const tags = new Set(variant?.tags ?? []);
  const supportPrior =
    (variant?.role === "support" ? 0.34 : 0) +
    (tags.has("healing") ? 0.16 : 0) +
    (tags.has("shield") ? 0.14 : 0) +
    (tags.has("peel") ? 0.10 : 0) +
    (tags.has("utility") ? 0.08 : 0);
  const supportStatMass = variant?.role === "support"
    ? protectRatio * 0.30 + healRatio * 0.16
    : protectRatio * 0.08 + healRatio * 0.02;

  return {
    frontline: clamp(takenRatio * 0.68 + melee + frontRole),
    damage: clamp(damageRatio * 0.82 + tempoRatio * 0.18),
    durability: clamp(takenRatio * 0.58 + stabilityRatio * 0.24 + healRatio * 0.10 + protectRatio * 0.08),
    cc: clamp(ccRatio),
    // healAmount contains a lot of self-sustain in Eternal Return, so it should
    // not directly mean "team support". Keep support conservative and move
    // self-survival pressure to sustain.
    support: clamp(supportStatMass + supportPrior + ccRatio * 0.03),
    sustain: clamp(healRatio * 0.40 + protectRatio * 0.12 + takenRatio * 0.22 + stabilityRatio * 0.18 + tempoRatio * 0.08),
    tempo: clamp(tempoRatio * 0.75 + div(avg.avgKills, globalAvg.avgKills, 1) * 0.25),
    stability: clamp(stabilityRatio),
  };
}

function currentVectorWithDerivedSustain(variant, core) {
  const current = characterVector(variant, core, "all");
  const tags = new Set(variant?.tags ?? []);
  return {
    ...current,
    // The current recommender has no first-class sustain axis yet. This derived
    // value only makes the diagnostic comparison less misleading.
    sustain: clamp(
      (current.durability ?? 0) * 0.52 +
      (current.support ?? 0) * 0.18 +
      (tags.has("sustain") || tags.has("sustained") ? 0.22 : 0) +
      (["frontline", "bruiser"].includes(variant?.role) ? 0.08 : 0)
    ),
  };
}

function vectorDelta(a, b) {
  return Object.fromEntries(AXES.map((axis) => [axis, round((a?.[axis] ?? 0) - (b?.[axis] ?? 0))]));
}

function vectorDistance(a, b) {
  return Math.sqrt(AXES.reduce((sum, axis) => sum + ((a?.[axis] ?? 0) - (b?.[axis] ?? 0)) ** 2, 0));
}

async function loadTraitNames(statsPath) {
  try {
    const payload = JSON.parse(await fs.readFile(statsPath, "utf8"));
    const out = new Map();
    const traits = payload.officialTraitBuildStatsByTier?.all ?? {};
    for (const rows of Object.values(traits)) {
      for (const row of rows ?? []) {
        if (row?.core && row?.name) out.set(String(row.core), row.name);
      }
    }
    return out;
  } catch {
    return new Map();
  }
}

function compareRecord({ key, variant, core, avg, globalAvg, traitNames }) {
  const empirical = empiricalVector(avg, globalAvg, variant);
  const current = currentVectorWithDerivedSustain(variant, core);
  const delta = vectorDelta(empirical, current);
  return {
    key,
    variantId: variant.variantId,
    characterId: variant.characterId,
    weapon: variant.weapon,
    role: variant.role,
    core: core ? String(core) : null,
    coreName: core ? traitNames.get(String(core)) ?? null : null,
    games: avg.games,
    top3Rate: round(avg.top3Rate),
    avgPlacement: round(avg.avgPlacement),
    metrics: Object.fromEntries(Object.entries(avg).map(([k, v]) => [k, round(v)])),
    empirical: Object.fromEntries(AXES.map((axis) => [axis, round(empirical[axis])])),
    current: Object.fromEntries(AXES.map((axis) => [axis, round(current[axis] ?? 0)])),
    delta,
    distance: round(vectorDistance(empirical, current)),
  };
}

function rowMd(row) {
  return `| ${row.key} | ${row.games} | ${row.coreName ?? "-"} | ${row.distance} | ${AXES.map((a) => `${a}:${row.delta[a]}`).join("<br>")} |`;
}

async function main() {
  const args = parseArgs();
  const traitNames = await loadTraitNames(args.stats);
  const weaponCodeToId = await inferWeaponCodeToId(args.in);
  const byVariant = new Map();
  const byBuild = new Map();
  const global = newAgg();
  let rawTeams = 0;
  let validTeams = 0;
  let mappedPlayers = 0;
  let skippedPlayers = 0;

  for await (const team of readTeams(args.in)) {
    rawTeams += 1;
    if ((team.players ?? []).length !== 3) continue;
    validTeams += 1;
    for (const player of team.players ?? []) {
      const variant = variantForPlayer(player, weaponCodeToId);
      if (!variant) {
        skippedPlayers += 1;
        continue;
      }
      mappedPlayers += 1;
      addAgg(global, team, player);
      addToMap(byVariant, variant.variantId, team, player);
      const core = player.traits?.core;
      if (core) addToMap(byBuild, statKey(variant.variantId, core), team, player);
    }
  }

  const globalAvg = averageAgg(global);
  const variantRecords = [...byVariant.entries()]
    .map(([key, agg]) => {
      const variant = characterVariants.find((v) => v.variantId === key);
      if (!variant) return null;
      return compareRecord({ key, variant, core: null, avg: averageAgg(agg), globalAvg, traitNames });
    })
    .filter(Boolean)
    .sort((a, b) => b.games - a.games);

  const buildRecords = [...byBuild.entries()]
    .map(([key, agg]) => {
      const [variantId, core] = key.split("#");
      const variant = characterVariants.find((v) => v.variantId === variantId);
      if (!variant) return null;
      return compareRecord({ key, variant, core, avg: averageAgg(agg), globalAvg, traitNames });
    })
    .filter(Boolean)
    .filter((row) => row.games >= args.minGames)
    .sort((a, b) => b.distance - a.distance);

  const focusIds = new Set(["luke", "barbara", "leni", "markus", "nathapon", "emma", "bihyung", "nia"]);
  const focus = buildRecords
    .filter((row) => focusIds.has(row.characterId))
    .sort((a, b) => a.characterId.localeCompare(b.characterId) || b.games - a.games);

  const report = {
    generatedAt: new Date().toISOString(),
    input: args.in,
    stats: args.stats,
    summary: {
      rawTeams,
      validTeams,
      mappedPlayers,
      skippedPlayers,
      global: Object.fromEntries(Object.entries(globalAvg).map(([k, v]) => [k, round(v)])),
      variants: variantRecords.length,
      builds: buildRecords.length,
      minGames: args.minGames,
    },
    notes: [
      "Empirical vectors are diagnostic only. They do not change app recommendations until wired into recommender.js.",
      "frontline/durability are derived from damageFromPlayer plus role/range priors.",
      "support is intentionally conservative: mostly protectAbsorb plus support-role/tag priors. healAmount is mostly routed to sustain because it includes self-sustain.",
      "sustain captures healAmount, damage intake, stability, and combat uptime. Current recommender has no direct sustain axis, so current.sustain is derived for diagnostics only.",
    ],
    topDifferences: buildRecords.slice(0, args.top),
    focus,
    variantTopByGames: variantRecords.slice(0, args.top),
  };

  await fs.mkdir(args.outDir, { recursive: true });
  const jsonPath = path.join(args.outDir, "empirical-spectrum-report.json");
  const mdPath = path.join(args.outDir, "empirical-spectrum-report.md");
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");
  await fs.writeFile(mdPath, [
    "# Empirical Spectrum Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Input: \`${args.in}\``,
    "",
    "## Summary",
    "",
    `- Raw teams: ${rawTeams}`,
    `- Valid 3-member teams: ${validTeams}`,
    `- Mapped players: ${mappedPlayers}`,
    `- Skipped players: ${skippedPlayers}`,
    `- Build rows over minGames=${args.minGames}: ${buildRecords.length}`,
    "",
    "## Global Averages",
    "",
    "```json",
    JSON.stringify(report.summary.global, null, 2),
    "```",
    "",
    "## Focus Characters",
    "",
    "| build | games | core | distance | empirical-current delta |",
    "|---|---:|---|---:|---|",
    ...focus.map(rowMd),
    "",
    "## Largest Current-vs-Empirical Differences",
    "",
    "| build | games | core | distance | empirical-current delta |",
    "|---|---:|---|---:|---|",
    ...buildRecords.slice(0, args.top).map(rowMd),
    "",
  ].join("\n"), "utf8");

  console.log(`saved: ${jsonPath}`);
  console.log(`saved: ${mdPath}`);
  console.log(JSON.stringify(report.summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
