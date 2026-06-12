import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { characters } from "../src/data.js";
import { requireEnv } from "./env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BASE_URL = process.env.ER_API_BASE_URL?.trim() || "https://open-api.bser.io";
const DEFAULT_IN = path.join(ROOT, "data", "official-match-input.json");
const DEFAULT_OUT = path.join(ROOT, "src", "officialMatchStats.js");
const CACHE_DIR = path.join(ROOT, "data", "official-cache");

const FALLBACK_CHARACTER_CODE_TO_ID = {
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
  77: "hisui",
  78: "yumin",
  79: "justina",
  80: "ian",
  81: "istvan",
  82: "blair",
  83: "bihyung",
  84: "coreline",
  85: "fenrir",
  86: "shirin",
  87: "henry",
  88: "mirka",
};

function parseArgs() {
  const args = { in: [DEFAULT_IN], out: DEFAULT_OUT, minGames: 2, fetchCharacterData: true };
  for (let index = 2; index < process.argv.length; index += 1) {
    const key = process.argv[index];
    if (!key.startsWith("--")) continue;
    const value = process.argv[index + 1];
    index += 1;
    if (key === "--in") {
      // First explicit --in replaces the default; subsequent ones append
      const resolved = path.resolve(ROOT, value);
      if (args._inExplicit) { args.in.push(resolved); }
      else { args.in = [resolved]; args._inExplicit = true; }
    }
    if (key === "--out") args.out = path.resolve(ROOT, value);
    if (key === "--min-games") args.minGames = Number(value);
    if (key === "--no-fetch-character-data") args.fetchCharacterData = false;
  }
  return args;
}

function cacheName(value) {
  return Buffer.from(value).toString("base64url") + ".json";
}

async function readCache(cacheKey) {
  try {
    return JSON.parse(await fs.readFile(path.join(CACHE_DIR, cacheName(cacheKey)), "utf8"));
  } catch {
    return undefined;
  }
}

async function writeCache(cacheKey, payload) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(path.join(CACHE_DIR, cacheName(cacheKey)), JSON.stringify(payload), "utf8");
}

async function fetchJson(endpoint, cacheKey) {
  const cached = await readCache(cacheKey);
  if (cached) return cached;
  const apiKey = requireEnv("ER_API_KEY");
  const response = await fetch(`${BASE_URL}${endpoint}`, { headers: { "x-api-key": apiKey } });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${endpoint}`);
  await writeCache(cacheKey, payload);
  return payload;
}

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[&·.\-_\s'’]/g, "");
}

function firstValue(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function flattenRows(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(flattenRows);
  if (typeof value !== "object") return [];
  const hasCode = firstValue(value, ["code", "characterCode", "characterNum", "id", "key"]) !== undefined;
  const hasName = firstValue(value, ["name", "nameKr", "nameKo", "nameKor", "characterName", "korName"]) !== undefined;
  if (hasCode && hasName) return [value];
  return Object.values(value).flatMap(flattenRows);
}

function localNameIndex() {
  const aliases = new Map([
    ["쇼우", "sho"],
    ["리다이린", "li_dailin"],
    ["데비마를렌", "debi_marlene"],
    ["데비&마를렌", "debi_marlene"],
    ["코렐라인", "coreline"],
    ["유민", "yumin"],
  ]);
  for (const character of characters) {
    aliases.set(normalizeName(character.name), character.id);
    aliases.set(normalizeName(character.id), character.id);
  }
  return aliases;
}

async function buildCharacterCodeMap(fetchCharacterData) {
  const codeMap = new Map(Object.entries(FALLBACK_CHARACTER_CODE_TO_ID).map(([code, id]) => [String(code), id]));
  if (!fetchCharacterData) return codeMap;

  try {
    const payload = await fetchJson("/v1/data/Character", "data:Character");
    const index = localNameIndex();
    for (const row of flattenRows(payload)) {
      const code = firstValue(row, ["code", "characterCode", "characterNum", "id", "key"]);
      const name = firstValue(row, ["name", "nameKr", "nameKo", "nameKor", "characterName", "korName"]);
      const localId = index.get(normalizeName(name));
      if (code !== undefined && localId) codeMap.set(String(code), localId);
    }
  } catch (error) {
    console.warn(`official character data fetch skipped: ${error.message}`);
  }

  return codeMap;
}

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function teamResult(team) {
  const rank = numeric(team.rank, 0);
  return {
    placement: rank > 0 ? rank : undefined,
    win: Boolean(team.victory) || rank === 1,
    top3: rank > 0 && rank <= 3,
  };
}

function ensureBucket(target, bucket) {
  if (!target[bucket]) target[bucket] = {};
  return target[bucket];
}

function bumpCounter(target, key) {
  if (key === undefined || key === null || key === "" || (Array.isArray(key) && key.length === 0)) return;
  if (Array.isArray(key)) {
    key.forEach((item) => bumpCounter(target, item));
    return;
  }
  const text = String(key);
  target[text] = (target[text] ?? 0) + 1;
}

function addCandidateStat(bucketStats, characterId, team, player) {
  if (!bucketStats[characterId]) {
    bucketStats[characterId] = {
      games: 0,
      placementSum: 0,
      placementGames: 0,
      wins: 0,
      top3: 0,
      damageToPlayer: 0,
      damageFromPlayer: 0,
      ccTime: 0,
      ccCount: 0,
      traitCores: {},
      tacticalSkills: {},
    };
  }
  const stat = bucketStats[characterId];
  const result = teamResult(team);
  const playerStats = player.stats ?? {};
  stat.games += 1;
  if (result.placement !== undefined) {
    stat.placementSum += result.placement;
    stat.placementGames += 1;
  }
  if (result.win) stat.wins += 1;
  if (result.top3) stat.top3 += 1;
  stat.damageToPlayer += numeric(playerStats.damageToPlayer);
  stat.damageFromPlayer += numeric(playerStats.damageFromPlayer);
  stat.ccTime += numeric(playerStats.ccTime);
  stat.ccCount += numeric(playerStats.ccCount);
  bumpCounter(stat.traitCores, player.traits?.core);
  bumpCounter(stat.tacticalSkills, player.traits?.tacticalSkill);
}

function compositionKey(teammates, candidate) {
  return `${teammates.slice().sort().join("|")}=>${candidate}`;
}

function addCompositionStat(bucketStats, candidateId, teammateIds, team) {
  const teammates = teammateIds.filter((id) => id && id !== candidateId).sort();
  if (teammates.length < 1) return;
  const key = compositionKey(teammates, candidateId);
  if (!bucketStats[key]) {
    bucketStats[key] = {
      teammates,
      candidate: candidateId,
      games: 0,
      placementSum: 0,
      placementGames: 0,
      wins: 0,
      top3: 0,
    };
  }
  const stat = bucketStats[key];
  const result = teamResult(team);
  stat.games += 1;
  if (result.placement !== undefined) {
    stat.placementSum += result.placement;
    stat.placementGames += 1;
  }
  if (result.win) stat.wins += 1;
  if (result.top3) stat.top3 += 1;
}

function finalizeCandidateStats(source, minGames) {
  const output = {};
  for (const [characterId, stat] of Object.entries(source).sort(([a], [b]) => a.localeCompare(b))) {
    if (stat.games < minGames) continue;
    output[characterId] = {
      games: stat.games,
      avgPlacement: stat.placementGames ? round(stat.placementSum / stat.placementGames, 2) : undefined,
      winRate: round(stat.wins / stat.games, 3),
      top3Rate: round(stat.top3 / stat.games, 3),
      avgDamageToPlayer: Math.round(stat.damageToPlayer / stat.games),
      avgDamageFromPlayer: Math.round(stat.damageFromPlayer / stat.games),
      avgCcTime: round(stat.ccTime / stat.games, 2),
      avgCcCount: round(stat.ccCount / stat.games, 2),
    };
  }
  return output;
}

function topCounters(source, limit = 5) {
  return Object.fromEntries(
    Object.entries(source ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit),
  );
}

function finalizeTraitStats(source, minGames) {
  const output = {};
  for (const [characterId, stat] of Object.entries(source).sort(([a], [b]) => a.localeCompare(b))) {
    if (stat.games < minGames) continue;
    output[characterId] = {
      games: stat.games,
      traitCores: topCounters(stat.traitCores),
      tacticalSkills: topCounters(stat.tacticalSkills),
    };
  }
  return output;
}

function finalizeCompositionStats(source, minGames) {
  return Object.values(source)
    .filter((stat) => stat.games >= minGames)
    .map((stat) => ({
      teammates: stat.teammates,
      candidate: stat.candidate,
      games: stat.games,
      avgPlacement: stat.placementGames ? round(stat.placementSum / stat.placementGames, 2) : undefined,
      winRate: round(stat.wins / stat.games, 3),
      top3Rate: round(stat.top3 / stat.games, 3),
    }))
    .sort((a, b) => b.games - a.games || a.candidate.localeCompare(b.candidate));
}

function round(value, digits) {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function stableJson(value) {
  return JSON.stringify(value, null, 2);
}

async function build() {
  const args = parseArgs();

  // Merge teams from all input files (dedup by gameId:teamKey)
  const dedupKeys = new Set();
  const allTeams = [];
  for (const inPath of args.in) {
    let data;
    try { data = JSON.parse(await fs.readFile(inPath, "utf8")); }
    catch { console.warn(`WARNING: could not read ${inPath}, skipping`); continue; }
    const before = allTeams.length;
    for (const team of data.teams ?? []) {
      const key = `${team.gameId}:${team.teamKey}`;
      if (dedupKeys.has(key)) continue;
      dedupKeys.add(key);
      allTeams.push(team);
    }
    console.log(`Loaded ${path.relative(ROOT, inPath)}: ${allTeams.length - before} teams (total: ${allTeams.length})`);
  }

  const codeMap = await buildCharacterCodeMap(args.fetchCharacterData);
  const candidateByTier = {};
  const compositionByTier = {};
  const mappedCodes = new Set();
  const unmappedCodes = new Set();
  let mappedTeams = 0;

  for (const team of allTeams) {
    const players = (team.players ?? [])
      .map((player) => {
        const id = codeMap.get(String(player.character));
        if (id) mappedCodes.add(String(player.character));
        else unmappedCodes.add(String(player.character));
        return id ? { ...player, characterId: id } : undefined;
      })
      .filter(Boolean);

    const memberIds = [...new Set(players.map((player) => player.characterId))].sort();
    if (memberIds.length < 2) continue;
    mappedTeams += 1;

    const buckets = ["all", team.tierBucket || "unknown"];
    for (const bucket of buckets) {
      const candidateBucket = ensureBucket(candidateByTier, bucket);
      const compositionBucket = ensureBucket(compositionByTier, bucket);
      for (const player of players) {
        addCandidateStat(candidateBucket, player.characterId, team, player);
        addCompositionStat(compositionBucket, player.characterId, memberIds, team);
      }
    }
  }

  const officialCandidateStatsByTier = {};
  const officialTraitStatsByTier = {};
  const officialCompositionStatsByTier = {};
  for (const bucket of Object.keys(candidateByTier).sort()) {
    officialCandidateStatsByTier[bucket] = finalizeCandidateStats(candidateByTier[bucket], args.minGames);
    officialTraitStatsByTier[bucket] = finalizeTraitStats(candidateByTier[bucket], args.minGames);
    officialCompositionStatsByTier[bucket] = finalizeCompositionStats(compositionByTier[bucket] ?? {}, args.minGames);
  }

  const source = {
    source: input.source ?? "official-api",
    generatedAt: new Date().toISOString(),
    inputGeneratedAt: input.generatedAt,
    season: input.options?.season,
    teamMode: input.options?.teamMode,
    rankers: input.options?.rankers,
    gamesPerUser: input.options?.gamesPerUser,
    teams: (input.teams ?? []).length,
    mappedTeams,
    mappedCharacters: mappedCodes.size,
    unmappedCharacterCodes: [...unmappedCodes].sort((a, b) => Number(a) - Number(b)),
    minGames: args.minGames,
    privacy: input.privacy,
  };

  const contents = `export const OFFICIAL_MATCH_SOURCE = ${stableJson(source)};

export const officialCandidateStatsByTier = ${stableJson(officialCandidateStatsByTier)};

export const officialCompositionStatsByTier = ${stableJson(officialCompositionStatsByTier)};

export const officialTraitStatsByTier = ${stableJson(officialTraitStatsByTier)};

export function officialStatsBucketForTier(tier = "all") {
  const bucketMap = {
    all: "all",
    iron_bronze: "bronze",
    silver_gold: "gold",
    platinum_diamond: "diamond",
    meteor_mithril: "mithril_plus",
    demigod_eternity: "mithril_plus",
  };
  const preferred = bucketMap[tier] ?? tier ?? "all";
  if (officialCandidateStatsByTier[preferred] || officialCompositionStatsByTier[preferred]) return preferred;
  return "all";
}
`;

  await fs.writeFile(args.out, contents, "utf8");
  console.log(`saved: ${path.relative(ROOT, args.out)}`);
  console.log(`teams: ${source.teams}, mapped teams: ${source.mappedTeams}, mapped characters: ${source.mappedCharacters}`);
  if (source.unmappedCharacterCodes.length) {
    console.log(`unmapped character codes: ${source.unmappedCharacterCodes.join(", ")}`);
  }
}

build().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
