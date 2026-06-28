/**
 * export_ml_training_data.mjs
 *
 * Converts collected official match input into JSONL for future ML training.
 * The output is intentionally kept out of git and uploaded as a GitHub Actions
 * artifact. Each line represents one valid 3-player team.
 */

import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { characters, characterVariants } from "../src/data.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const DEFAULT_IN = path.join(ROOT, "data", "official-match-input-accumulated.json");
const DEFAULT_OUT_DIR = path.join(ROOT, "data", "ml-training");

const CHARACTER_CODE_TO_ID = {
  1: "jackie",
  2: "aya",
  3: "fiora",
  4: "magnus",
  5: "zahir",
  6: "nadine",
  7: "hyunwoo",
  8: "hart",
  9: "isol",
  10: "li_dailin",
  11: "yuki",
  12: "hyejin",
  13: "sho",
  14: "chiara",
  15: "sissela",
  16: "silvia",
  17: "adriana",
  18: "shoichi",
  19: "emma",
  20: "lenox",
  21: "rozzi",
  22: "luke",
  23: "cathy",
  24: "adela",
  25: "bernice",
  26: "barbara",
  27: "alex",
  28: "sua",
  29: "leon",
  30: "eleven",
  31: "rio",
  32: "william",
  33: "nicky",
  34: "nathapon",
  35: "yan",
  36: "eva",
  37: "daniel",
  38: "jenny",
  39: "camilo",
  40: "chloe",
  41: "johann",
  42: "bianca",
  43: "celine",
  44: "echion",
  45: "mai",
  46: "aiden",
  47: "laura",
  48: "tia",
  49: "felix",
  50: "elena",
  51: "priya",
  52: "adina",
  53: "markus",
  54: "karla",
  55: "estelle",
  56: "piolo",
  57: "martina",
  58: "haze",
  59: "isaac",
  60: "tazia",
  61: "irem",
  62: "theodore",
  63: "ian",
  64: "vanya",
  65: "debi_marlene",
  66: "arda",
  67: "abigail",
  68: "alonso",
  69: "leni",
  70: "tsubame",
  71: "kenneth",
  72: "katja",
  73: "charlotte",
  74: "darko",
  75: "lenore",
  76: "garnet",
  77: "yumin",
  78: "hisui",
  79: "justina",
  80: "istvan",
  81: "nia",
  82: "shirin",
  83: "henry",
  84: "blair",
  85: "mirka",
  86: "fenrir",
  87: "coreline",
  88: "bihyung",
};

const characterById = new Map(characters.map((character) => [character.id, character]));
const variantsByCharacter = characterVariants.reduce((map, variant) => {
  if (!map.has(variant.characterId)) map.set(variant.characterId, []);
  map.get(variant.characterId).push(variant);
  return map;
}, new Map());

function parseArgs() {
  const args = {
    in: DEFAULT_IN,
    outDir: DEFAULT_OUT_DIR,
    out: null, // 정확 출력 파일 경로(지정 시 outDir/타임스탬프 대신 사용)
    patch: process.env.CURRENT_PATCH || "",
  };
  for (let index = 2; index < process.argv.length; index += 1) {
    const key = process.argv[index];
    if (!key.startsWith("--")) continue;
    const value = process.argv[index + 1];
    index += 1;
    if (key === "--in") args.in = path.resolve(ROOT, value);
    if (key === "--out-dir") args.outDir = path.resolve(ROOT, value);
    if (key === "--out") args.out = path.resolve(ROOT, value);
    if (key === "--patch") args.patch = value;
  }
  return args;
}

async function projectVersion() {
  try {
    const packageJson = JSON.parse(await fs.readFile(path.join(ROOT, "package.json"), "utf8"));
    return packageJson.version || "unknown";
  } catch {
    return "unknown";
  }
}

function safeFilePart(value) {
  return String(value || "current").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function resultForTeam(team) {
  const placement = numeric(team.rank, 0);
  return {
    placement: placement > 0 ? placement : null,
    isWin: Boolean(team.victory) || placement === 1,
    isTop3: placement > 0 && placement <= 3,
  };
}

// 스트리밍 친화: 팀 1개씩 counts에 누적(메모리에 전체 팀을 안 올림).
function accumulateWeaponCounts(team, counts) {
  for (const player of team.players ?? []) {
    const characterId = CHARACTER_CODE_TO_ID[String(player.character)];
    const weaponCode = player.weapon;
    if (!characterId || weaponCode === undefined || weaponCode === null || weaponCode === "") continue;
    const variants = variantsByCharacter.get(characterId) ?? [];
    const weapon = variants.length === 1 ? variants[0].weapon : undefined;
    if (!weapon) continue;
    const key = String(weaponCode);
    if (!counts.has(key)) counts.set(key, new Map());
    const weaponCounts = counts.get(key);
    weaponCounts.set(weapon, (weaponCounts.get(weapon) ?? 0) + 1);
  }
}
function finalizeWeaponMap(counts) {
  const output = new Map();
  for (const [code, weaponCounts] of counts) {
    const [weapon] = [...weaponCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (weapon) output.set(code, weapon);
  }
  return output;
}

function variantForPlayer(characterId, weaponCode, weaponCodeToId) {
  const variants = variantsByCharacter.get(characterId) ?? [];
  if (variants.length === 1) return variants[0];

  const weapon = weaponCodeToId.get(String(weaponCode));
  return weapon
    ? variants.find((variant) => variant.weapon === weapon)
    : undefined;
}

function compactPlayer(player, weaponCodeToId) {
  const characterId = CHARACTER_CODE_TO_ID[String(player.character)] ?? null;
  const character = characterId ? characterById.get(characterId) : undefined;
  const variant = characterId ? variantForPlayer(characterId, player.weapon, weaponCodeToId) : undefined;
  const stats = player.stats ?? {};
  return {
    characterId,
    characterCode: player.character ?? null,
    weapon: variant?.weapon ?? null,
    weaponCode: player.weapon ?? null,
    variantId: variant?.variantId ?? characterId,
    role: variant?.role ?? character?.role ?? null,
    weaponRange: variant?.weaponRange ?? null,
    tags: variant?.tags ?? character?.tags ?? [],
    traits: player.traits ?? {},
    stats: {
      kills: numeric(stats.kills),
      assists: numeric(stats.assists),
      teamKills: numeric(stats.teamKills),
      damageToPlayer: numeric(stats.damageToPlayer),
      damageToPlayerBasic: numeric(stats.damageToPlayerBasic),
      damageToPlayerSkill: numeric(stats.damageToPlayerSkill),
      damageToPlayerItemSkill: numeric(stats.damageToPlayerItemSkill),
      damageToPlayerDirect: numeric(stats.damageToPlayerDirect),
      damageToPlayerUniqueSkill: numeric(stats.damageToPlayerUniqueSkill),
      damageFromPlayer: numeric(stats.damageFromPlayer),
      damageFromPlayerBasic: numeric(stats.damageFromPlayerBasic),
      damageFromPlayerSkill: numeric(stats.damageFromPlayerSkill),
      ccCount: numeric(stats.ccCount),
      ccTime: numeric(stats.ccTime),
      healAmount: numeric(stats.healAmount),
      protectAbsorb: numeric(stats.protectAbsorb),
      visionScore: numeric(stats.visionScore),
    },
  };
}

function teamFeatures(members) {
  const roles = {};
  const tags = {};
  let meleeCount = 0;
  let rangedCount = 0;
  let totalDamageToPlayer = 0;
  let totalDamageFromPlayer = 0;
  let totalCcTime = 0;
  let totalCcCount = 0;

  for (const member of members) {
    if (member.role) roles[member.role] = (roles[member.role] ?? 0) + 1;
    if (member.weaponRange === "melee") meleeCount += 1;
    if (member.weaponRange === "ranged") rangedCount += 1;
    for (const tag of member.tags ?? []) tags[tag] = (tags[tag] ?? 0) + 1;
    totalDamageToPlayer += member.stats.damageToPlayer;
    totalDamageFromPlayer += member.stats.damageFromPlayer;
    totalCcTime += member.stats.ccTime;
    totalCcCount += member.stats.ccCount;
  }

  return {
    roles,
    tags,
    frontlineCount: roles.frontline ?? 0,
    bruiserCount: roles.bruiser ?? 0,
    rangedCount: roles.ranged ?? 0,
    mageCount: roles.mage ?? 0,
    assassinCount: roles.assassin ?? 0,
    supportCount: roles.support ?? 0,
    meleeCount,
    weaponRangedCount: rangedCount,
    ccTagCount: tags.cc ?? 0,
    initiateTagCount: (tags.initiate ?? 0) + (tags.engage ?? 0),
    peelTagCount: tags.peel ?? 0,
    totalDamageToPlayer,
    totalDamageFromPlayer,
    totalCcTime,
    totalCcCount,
  };
}

// JSONL을 한 줄씩 스트리밍(전체 문자열/배열로 안 올림 → 대용량 안전).
async function* jsonlTeams(file) {
  const rl = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    const s = line.trim();
    if (!s) continue;
    try { yield JSON.parse(s); } catch { /* 깨진 줄 skip */ }
  }
}
// 팀 1개 → 출력 레코드(또는 skip 사유).
function teamToRow(team, weaponCodeToId, ctx) {
  const members = (team.players ?? []).map((player) => compactPlayer(player, weaponCodeToId));
  if (members.some((member) => !member.characterId)) return { skip: "unknownChar" };
  const memberKeys = new Set(members.map((member) => member.variantId ?? member.characterId));
  if (memberKeys.size !== 3) return { skip: "invalidSize" };
  return { row: {
    schemaVersion: 1,
    source: ctx.raw.source ?? "official-api",
    generatedAt: ctx.generatedAt,
    collectedAt: team.collectedAt ?? ctx.raw.generatedAt ?? null,
    patch: ctx.patch,
    seasonId: team.seasonId ?? ctx.raw.collection?.season ?? null,
    matchingMode: team.matchingMode ?? ctx.raw.collection?.matchingMode ?? null,
    matchingTeamMode: team.matchingTeamMode ?? ctx.raw.collection?.teamMode ?? null,
    tierBucket: team.tierBucket ?? "unknown",
    fineBucket: team.fineBucket ?? null,
    sourceRankMmr: team.sourceRankMmr ?? null,
    gameId: team.gameId,
    teamKey: team.teamKey,
    result: resultForTeam(team),
    members,
    teamFeatures: teamFeatures(members),
  } };
}

async function main() {
  const args = parseArgs();
  // 입력은 JSON({teams:[...]}) 또는 JSONL(팀 1줄). 아카이브 corpus(대용량)는 JSONL → 스트리밍.
  let raw = {};
  let arrayTeams = null;
  const isJsonl = /\.jsonl$/i.test(args.in);
  if (!isJsonl) {
    raw = JSON.parse(await fs.readFile(args.in, "utf8"));
    arrayTeams = Array.isArray(raw.teams) ? raw.teams : [];
  }
  const eachTeam = () => (isJsonl ? jsonlTeams(args.in) : arrayTeams);

  const patch = args.patch || raw.patch || process.env.CURRENT_PATCH || await projectVersion();
  const generatedAt = new Date().toISOString();
  const stamp = generatedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const outPath = args.out ?? path.join(args.outDir, `matches-${safeFilePart(patch)}-${stamp}.jsonl`);
  const manifestPath = outPath.replace(/\.jsonl$/i, ".manifest.json");

  // 1차 패스: weaponCode→weapon 맵 추론 (스트리밍).
  const weaponCounts = new Map();
  let rawTeams = 0;
  for await (const team of eachTeam()) {
    rawTeams += 1;
    accumulateWeaponCounts(team, weaponCounts);
  }
  const weaponCodeToId = finalizeWeaponMap(weaponCounts);

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const handle = await fs.open(outPath, "w");

  const ctx = { generatedAt, patch, raw };
  let exported = 0;
  let skippedInvalidSize = 0;
  let skippedUnknownCharacter = 0;

  // 2차 패스: 변환 + 기록 (스트리밍).
  try {
    for await (const team of eachTeam()) {
      const out = teamToRow(team, weaponCodeToId, ctx);
      if (out.skip === "unknownChar") { skippedUnknownCharacter += 1; continue; }
      if (out.skip === "invalidSize") { skippedInvalidSize += 1; continue; }
      await handle.write(`${JSON.stringify(out.row)}\n`);
      exported += 1;
    }
  } finally {
    await handle.close();
  }

  const manifest = {
    schemaVersion: 1,
    generatedAt,
    patch,
    input: path.relative(ROOT, args.in),
    output: path.relative(ROOT, outPath),
    rawTeams,
    exportedTeams: exported,
    skippedTeams: {
      invalidSize: skippedInvalidSize,
      unknownCharacter: skippedUnknownCharacter,
    },
    note: "JSONL is for long-term offline ML training. It is uploaded as an artifact and should not be committed to git.",
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  console.log(`saved ML JSONL: ${path.relative(ROOT, outPath)} (${exported} teams)`);
  console.log(`saved manifest: ${path.relative(ROOT, manifestPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

