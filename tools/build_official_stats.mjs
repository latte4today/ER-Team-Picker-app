import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { characters, characterVariants } from "../src/data.js";
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
  63: "nia",
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
  const args = { in: [DEFAULT_IN], out: DEFAULT_OUT, minGames: 2, fetchCharacterData: true, patch: process.env.CURRENT_PATCH || 'current', jsonOut: DEFAULT_OUT.replace(/\.js$/, '.json') };
  for (let index = 2; index < process.argv.length; index += 1) {
    const key = process.argv[index];
    if (!key.startsWith("--")) continue;
    if (key === "--no-fetch-character-data") {
      args.fetchCharacterData = false;
      continue;
    }
    const value = process.argv[index + 1];
    index += 1;
    if (key === "--in") {
      // First explicit --in replaces the default; subsequent ones append
      const resolved = path.resolve(ROOT, value);
      if (args._inExplicit) { args.in.push(resolved); }
      else { args.in = [resolved]; args._inExplicit = true; }
    }
    if (key === "--out") args.out = path.resolve(ROOT, value);
    if (key === "--json-out") args.jsonOut = path.resolve(ROOT, value);
    if (key === "--min-games") args.minGames = Number(value);
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

function flattenCodeRows(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(flattenCodeRows);
  if (typeof value !== "object") return [];
  if (Array.isArray(value.data)) return value.data.flatMap(flattenCodeRows);
  const hasCode = firstValue(value, ["code", "traitCode", "characterCode", "characterNum", "id", "key"]) !== undefined;
  if (hasCode) return [value];
  return Object.values(value).flatMap(flattenCodeRows);
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

const CURRENT_TRAIT_NAMES_BY_GROUP = {
  Havoc: {
    core: ["취약", "흡혈마", "아드레날린", "액셀러레이터"],
    sub1: ["열세극복", "광분", "약자 멸시", "상흔"],
    sub2: ["곰 탈", "멧돼지 탈", "늑대 탈", "들개 탈"],
  },
  Chaos: {
    core: ["스텔라 차지", "도깨비불", "벽력", "와류"],
    sub1: ["서큘러 시스템", "상처 악화", "철갑탄", "속사"],
    sub2: ["힘의 축적", "오버워치", "R_echarger", "천상의 수집품"],
  },
  Resistance: {
    core: ["금강", "불괴", "빛의 수호", "응징"],
    sub1: ["대담", "진통제", "불굴", "경계심"],
    sub2: ["견고", "먹보", "특공대", "담금질"],
  },
  Fortification: {
    core: ["금강", "불괴", "빛의 수호", "응징"],
    sub1: ["대담", "진통제", "불굴", "경계심"],
    sub2: ["견고", "먹보", "특공대", "담금질"],
  },
  Support: {
    core: ["초재생", "증폭 드론", "치유 드론", "헌신"],
    sub1: ["사냥의 전율", "가시 덤불", "위압감", "폭발 선인장"],
    sub2: ["후방 보급", "코인 토스", "할인 쿠폰", "캠핑 가이드"],
  },
};

function currentTraitNameFromSort(row) {
  const group = String(firstValue(row, ["traitGroup", "group"]) ?? "");
  const sortOrder = Number(firstValue(row, ["traitSortOrder", "sortOrder", "order"]));
  if (!group || !Number.isFinite(sortOrder)) return undefined;

  const names = CURRENT_TRAIT_NAMES_BY_GROUP[group];
  if (!names) return undefined;

  const rowType = String(firstValue(row, ["traitType", "type"]) ?? "").toLowerCase();
  const localOrder = sortOrder % 100;
  const index = (localOrder % 10) - 1;
  let category;
  if (rowType.includes("core") || (localOrder >= 1 && localOrder <= 4)) category = "core";
  else if (rowType.includes("sub1") || (localOrder >= 11 && localOrder <= 14)) category = "sub1";
  else if (rowType.includes("sub2") || (localOrder >= 21 && localOrder <= 24)) category = "sub2";
  if (!category || index < 0) return undefined;

  return names[category]?.[index];
}

async function buildTraitNameMap(fetchData) {
  const map = new Map();
  if (!fetchData) return map;
  for (const [version, table] of [["v2", "Trait"], ["v1", "Trait"], ["v1", "TraitCombat"], ["v1", "TraitSupport"]]) {
    try {
      const payload = await fetchJson(`/${version}/data/${table}`, `data:${version}:${table}`);
      for (const row of flattenCodeRows(payload)) {
        const code = firstValue(row, ["code", "traitCode", "id", "key"]);
        const name = firstValue(row, ["name", "nameKr", "nameKo", "traitName", "korName"]) ?? currentTraitNameFromSort(row);
        if (code !== undefined && name) map.set(String(code), String(name));
      }
    } catch (error) {
      console.warn(`Trait name fetch skipped for ${version}/${table}: ${error.message}`);
    }
  }
  console.log(`Trait name map: ${map.size} entries`);
  return map;
}

function traitCoreCode(player) {
  const core = player?.traits?.core;
  if (core === undefined || core === null || core === "") return undefined;
  return String(core);
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

const variantsByCharacter = characterVariants.reduce((map, variant) => {
  if (!map.has(variant.characterId)) map.set(variant.characterId, []);
  map.get(variant.characterId).push(variant);
  return map;
}, new Map());

function inferOfficialWeaponMap(teams, codeMap) {
  const counts = new Map();
  for (const team of teams) {
    for (const player of team.players ?? []) {
      const characterId = codeMap.get(String(player.character));
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

  const output = new Map();
  for (const [code, weaponCounts] of counts) {
    const [weapon] = [...weaponCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (weapon) output.set(code, weapon);
  }
  return output;
}

function statIdForPlayer(player, weaponCodeToId) {
  const variants = variantsByCharacter.get(player.characterId) ?? [];
  if (variants.length === 1) return variants[0].variantId;

  const weapon = weaponCodeToId.get(String(player.weapon));
  const variant = weapon
    ? variants.find((item) => item.weapon === weapon)
    : undefined;
  return variant?.variantId ?? player.characterId;
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
      damageToPlayerBasic: 0,
      damageToPlayerSkill: 0,
      damageToPlayerItemSkill: 0,
      damageToPlayerDirect: 0,
      damageToPlayerUniqueSkill: 0,
      damageFromPlayer: 0,
      damageFromPlayerBasic: 0,
      damageFromPlayerSkill: 0,
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
  stat.damageToPlayerBasic += numeric(playerStats.damageToPlayerBasic);
  stat.damageToPlayerSkill += numeric(playerStats.damageToPlayerSkill);
  stat.damageToPlayerItemSkill += numeric(playerStats.damageToPlayerItemSkill);
  stat.damageToPlayerDirect += numeric(playerStats.damageToPlayerDirect);
  stat.damageToPlayerUniqueSkill += numeric(playerStats.damageToPlayerUniqueSkill);
  stat.damageFromPlayer += numeric(playerStats.damageFromPlayer);
  stat.damageFromPlayerBasic += numeric(playerStats.damageFromPlayerBasic);
  stat.damageFromPlayerSkill += numeric(playerStats.damageFromPlayerSkill);
  stat.ccTime += numeric(playerStats.ccTime);
  stat.ccCount += numeric(playerStats.ccCount);
  bumpCounter(stat.traitCores, player.traits?.core);
  bumpCounter(stat.tacticalSkills, player.traits?.tacticalSkill);
}

function addTraitBuildStat(bucketStats, statId, team, player) {
  const core = traitCoreCode(player);
  if (!core) return;

  if (!bucketStats[statId]) bucketStats[statId] = {};
  if (!bucketStats[statId][core]) {
    bucketStats[statId][core] = {
      games: 0,
      placementSum: 0,
      placementGames: 0,
      wins: 0,
      top3: 0,
      damageToPlayer: 0,
      damageToPlayerBasic: 0,
      damageToPlayerSkill: 0,
      damageToPlayerItemSkill: 0,
      damageToPlayerDirect: 0,
      damageToPlayerUniqueSkill: 0,
      damageFromPlayer: 0,
      damageFromPlayerBasic: 0,
      damageFromPlayerSkill: 0,
      ccTime: 0,
      ccCount: 0,
      firstSubTraits: {},
      secondSubTraits: {},
      tacticalSkills: {},
    };
  }

  const stat = bucketStats[statId][core];
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
  stat.damageToPlayerBasic += numeric(playerStats.damageToPlayerBasic);
  stat.damageToPlayerSkill += numeric(playerStats.damageToPlayerSkill);
  stat.damageToPlayerItemSkill += numeric(playerStats.damageToPlayerItemSkill);
  stat.damageToPlayerDirect += numeric(playerStats.damageToPlayerDirect);
  stat.damageToPlayerUniqueSkill += numeric(playerStats.damageToPlayerUniqueSkill);
  stat.damageFromPlayer += numeric(playerStats.damageFromPlayer);
  stat.damageFromPlayerBasic += numeric(playerStats.damageFromPlayerBasic);
  stat.damageFromPlayerSkill += numeric(playerStats.damageFromPlayerSkill);
  stat.ccTime += numeric(playerStats.ccTime);
  stat.ccCount += numeric(playerStats.ccCount);
  bumpCounter(stat.firstSubTraits, player.traits?.firstSub);
  bumpCounter(stat.secondSubTraits, player.traits?.secondSub);
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
    const damageToPlayer = stat.damageToPlayer || 0;
    output[characterId] = {
      games: stat.games,
      avgPlacement: stat.placementGames ? round(stat.placementSum / stat.placementGames, 2) : undefined,
      winRate: round(stat.wins / stat.games, 3),
      top3Rate: round(stat.top3 / stat.games, 3),
      avgDamageToPlayer: Math.round(stat.damageToPlayer / stat.games),
      avgDamageToPlayerBasic: Math.round(stat.damageToPlayerBasic / stat.games),
      avgDamageToPlayerSkill: Math.round(stat.damageToPlayerSkill / stat.games),
      avgDamageToPlayerItemSkill: Math.round(stat.damageToPlayerItemSkill / stat.games),
      avgDamageToPlayerDirect: Math.round(stat.damageToPlayerDirect / stat.games),
      avgDamageToPlayerUniqueSkill: Math.round(stat.damageToPlayerUniqueSkill / stat.games),
      basicDamageShare: damageToPlayer ? round(stat.damageToPlayerBasic / damageToPlayer, 3) : undefined,
      skillDamageShare: damageToPlayer ? round(stat.damageToPlayerSkill / damageToPlayer, 3) : undefined,
      uniqueSkillDamageShare: damageToPlayer ? round(stat.damageToPlayerUniqueSkill / damageToPlayer, 3) : undefined,
      avgDamageFromPlayer: Math.round(stat.damageFromPlayer / stat.games),
      avgDamageFromPlayerBasic: Math.round(stat.damageFromPlayerBasic / stat.games),
      avgDamageFromPlayerSkill: Math.round(stat.damageFromPlayerSkill / stat.games),
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

function finalizeTraitStats(source, minGames, traitNameMap = new Map()) {
  const output = {};
  for (const [characterId, stat] of Object.entries(source).sort(([a], [b]) => a.localeCompare(b))) {
    if (stat.games < minGames) continue;
    // Convert trait codes to { code, name, count } entries
    const traitCores = Object.entries(topCounters(stat.traitCores)).map(([code, count]) => ({
      code,
      name: traitNameMap.get(code) ?? null,
      count,
    }));
    const tacticalSkills = Object.entries(topCounters(stat.tacticalSkills)).map(([code, count]) => ({
      code,
      name: traitNameMap.get(code) ?? null,
      count,
    }));
    output[characterId] = { games: stat.games, traitCores, tacticalSkills };
  }
  return output;
}

function finalizeTraitBuildStats(source, minGames, traitNameMap = new Map()) {
  const output = {};
  for (const [statId, traits] of Object.entries(source).sort(([a], [b]) => a.localeCompare(b))) {
    const rows = [];
    for (const [core, stat] of Object.entries(traits).sort(([a], [b]) => a.localeCompare(b))) {
      if (stat.games < minGames) continue;
      const damageToPlayer = stat.damageToPlayer || 0;
      rows.push({
        core,
        name: traitNameMap.get(core) ?? null,
        games: stat.games,
        avgPlacement: stat.placementGames ? round(stat.placementSum / stat.placementGames, 2) : undefined,
        winRate: round(stat.wins / stat.games, 3),
        top3Rate: round(stat.top3 / stat.games, 3),
        avgDamageToPlayer: Math.round(stat.damageToPlayer / stat.games),
        avgDamageToPlayerBasic: Math.round(stat.damageToPlayerBasic / stat.games),
        avgDamageToPlayerSkill: Math.round(stat.damageToPlayerSkill / stat.games),
        avgDamageToPlayerItemSkill: Math.round(stat.damageToPlayerItemSkill / stat.games),
        avgDamageToPlayerDirect: Math.round(stat.damageToPlayerDirect / stat.games),
        avgDamageToPlayerUniqueSkill: Math.round(stat.damageToPlayerUniqueSkill / stat.games),
        basicDamageShare: damageToPlayer ? round(stat.damageToPlayerBasic / damageToPlayer, 3) : undefined,
        skillDamageShare: damageToPlayer ? round(stat.damageToPlayerSkill / damageToPlayer, 3) : undefined,
        uniqueSkillDamageShare: damageToPlayer ? round(stat.damageToPlayerUniqueSkill / damageToPlayer, 3) : undefined,
        avgDamageFromPlayer: Math.round(stat.damageFromPlayer / stat.games),
        avgDamageFromPlayerBasic: Math.round(stat.damageFromPlayerBasic / stat.games),
        avgDamageFromPlayerSkill: Math.round(stat.damageFromPlayerSkill / stat.games),
        avgCcTime: round(stat.ccTime / stat.games, 2),
        avgCcCount: round(stat.ccCount / stat.games, 2),
        firstSubTraits: Object.entries(topCounters(stat.firstSubTraits)).map(([code, count]) => ({
          code,
          name: traitNameMap.get(code) ?? null,
          count,
        })),
        secondSubTraits: Object.entries(topCounters(stat.secondSubTraits)).map(([code, count]) => ({
          code,
          name: traitNameMap.get(code) ?? null,
          count,
        })),
        tacticalSkills: Object.entries(topCounters(stat.tacticalSkills)).map(([code, count]) => ({
          code,
          name: traitNameMap.get(code) ?? null,
          count,
        })),
      });
    }
    if (rows.length) output[statId] = rows.sort((a, b) => b.games - a.games);
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


// ── Recency decay ─────────────────────────────────────────────────────────────
// Weight older games lower within a patch. lambda=0.02 → 50% weight at ~35 days.
function recencyWeight(collectedAt, lambda = 0.02) {
  if (!collectedAt) return 1;
  const daysAgo = (Date.now() - new Date(collectedAt).getTime()) / 86400000;
  return Math.exp(-lambda * Math.max(0, daysAgo));
}

// ── Pair stats ────────────────────────────────────────────────────────────────
function addPairStat(bucketStats, idA, idB, team, weight) {
  const key = [idA, idB].sort().join("|");
  if (!bucketStats[key]) {
    bucketStats[key] = { a: idA < idB ? idA : idB, b: idA < idB ? idB : idA, games: 0, wins: 0, top3: 0 };
  }
  const stat = bucketStats[key];
  const result = teamResult(team);
  stat.games += weight;
  if (result.win)  stat.wins  += weight;
  if (result.top3) stat.top3  += weight;
}

function finalizePairStats(source, minGames) {
  const output = {};
  for (const [key, stat] of Object.entries(source)) {
    if (stat.games < minGames) continue;
    output[key] = {
      a: stat.a, b: stat.b,
      games:   round(stat.games, 2),
      winRate: round(stat.wins / stat.games, 3),
      top3Rate: round(stat.top3 / stat.games, 3),
    };
  }
  return output;
}

// ── Combat stats ──────────────────────────────────────────────────────────────
function addCombatStat(bucketStats, characterId, player, weight) {
  if (!bucketStats[characterId]) {
    bucketStats[characterId] = { games: 0, kills: 0, assists: 0, teamKills: 0, damage: 0, ccTime: 0 };
  }
  const s = bucketStats[characterId];
  const ps = player.stats ?? {};
  s.games     += weight;
  s.kills     += numeric(ps.kills)         * weight;
  s.assists   += numeric(ps.assists)       * weight;
  s.teamKills += numeric(ps.teamKills)     * weight;
  s.damage    += numeric(ps.damageToPlayer) * weight;
  s.ccTime    += numeric(ps.ccTime)        * weight;
}

function finalizeCombatStats(source, minGames) {
  const output = {};
  for (const [characterId, s] of Object.entries(source)) {
    if (s.games < minGames) continue;
    output[characterId] = {
      games:           round(s.games, 2),
      avgKills:        round(s.kills    / s.games, 2),
      avgAssists:      round(s.assists  / s.games, 2),
      avgTeamKills:    round(s.teamKills / s.games, 2),
      avgDamage:       Math.round(s.damage / s.games),
      avgCcTime:       round(s.ccTime   / s.games, 2),
    };
  }
  return output;
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
  const traitNameMap = await buildTraitNameMap(args.fetchCharacterData);
  const weaponCodeToId = inferOfficialWeaponMap(allTeams, codeMap);
  const candidateByTier = {};
  const traitBuildByTier = {};
  const compositionByTier = {};
  const pairByTier = {};
  const combatByTier = {};
  const mappedCodes = new Set();
  const unmappedCodes = new Set();
  let mappedTeams = 0;
  let validTeams = 0;
  let droppedByUnknownChar = 0;
  let droppedByInvalidSize = 0;

  for (const team of allTeams) {
    const rw = recencyWeight(team.collectedAt ?? args.collectedAt);
    const rawPlayers = team.players ?? [];
    const players = rawPlayers
      .map((player) => {
        const id = codeMap.get(String(player.character));
        if (id) mappedCodes.add(String(player.character));
        else unmappedCodes.add(String(player.character));
        return id ? { ...player, characterId: id } : undefined;
      })
      .filter(Boolean)
      .map((player) => ({ ...player, statId: statIdForPlayer(player, weaponCodeToId) }));
    if (players.length < rawPlayers.length) droppedByUnknownChar += 1;

    const memberIds = [...new Set(players.map((player) => player.statId))].sort();
    mappedTeams += 1;
    if (memberIds.length !== 3) { droppedByInvalidSize += 1; continue; }
    validTeams += 1;

    const buckets = ["all", team.tierBucket || "unknown"];
    for (const bucket of buckets) {
      const candidateBucket = ensureBucket(candidateByTier, bucket);
      const traitBuildBucket = ensureBucket(traitBuildByTier, bucket);
      const compositionBucket = ensureBucket(compositionByTier, bucket);
      for (const player of players) {
        addCandidateStat(candidateBucket, player.statId, team, player);
        addTraitBuildStat(traitBuildBucket, player.statId, team, player);
        addCompositionStat(compositionBucket, player.statId, memberIds, team);
        addCombatStat(ensureBucket(combatByTier, bucket), player.statId, player, rw);
      }
      // Pair stats: all C(n,2) pairs in the team
      for (let pi = 0; pi < players.length; pi++) {
        for (let pj = pi + 1; pj < players.length; pj++) {
          addPairStat(ensureBucket(pairByTier, bucket), players[pi].statId, players[pj].statId, team, rw);
        }
      }
    }
  }

  const officialCandidateStatsByTier = {};
  const officialTraitStatsByTier = {};
  const officialTraitBuildStatsByTier = {};
  const officialCompositionStatsByTier = {};
  const officialPairStatsByTier = {};
  const officialCombatStatsByTier = {};
  const allBuckets = new Set([...Object.keys(candidateByTier), ...Object.keys(traitBuildByTier), ...Object.keys(pairByTier)]);
  for (const bucket of [...allBuckets].sort()) {
    officialCandidateStatsByTier[bucket] = finalizeCandidateStats(candidateByTier[bucket] ?? {}, args.minGames);
    officialTraitStatsByTier[bucket]     = finalizeTraitStats(candidateByTier[bucket] ?? {}, args.minGames, traitNameMap);
    officialTraitBuildStatsByTier[bucket] = finalizeTraitBuildStats(traitBuildByTier[bucket] ?? {}, args.minGames, traitNameMap);
    officialCompositionStatsByTier[bucket] = finalizeCompositionStats(compositionByTier[bucket] ?? {}, args.minGames);
    officialPairStatsByTier[bucket]      = finalizePairStats(pairByTier[bucket] ?? {}, args.minGames);
    officialCombatStatsByTier[bucket]    = finalizeCombatStats(combatByTier[bucket] ?? {}, args.minGames);
  }

  const source = {
    source: "official-api-merged",
    generatedAt: new Date().toISOString(),
    patch: args.patch,
    totalTeams: allTeams.length,
    mappedTeams,
    validTeams,
    droppedTeams: allTeams.length - validTeams,
    dropReasons: {
      unknownChar: droppedByUnknownChar,
      invalidSize: droppedByInvalidSize,
    },
    mappedCharacters: mappedCodes.size,
    mappedWeaponCodes: weaponCodeToId.size,
    unmappedCharacterCodes: [...unmappedCodes].sort((a, b) => Number(a) - Number(b)),
    minGames: args.minGames,
  };

  // Write JS file in chunks via stream to avoid string-size truncation on large data
  {
    const { createWriteStream } = await import("node:fs");
    const ws = createWriteStream(args.out, { encoding: "utf8" });
    const w = (s) => new Promise((res, rej) => ws.write(s, (e) => e ? rej(e) : res()));
    await w(`export const OFFICIAL_MATCH_SOURCE = ${stableJson(source)};\n\n`);
    await w(`export const officialCandidateStatsByTier = ${stableJson(officialCandidateStatsByTier)};\n\n`);
    await w(`export const officialCompositionStatsByTier = ${stableJson(officialCompositionStatsByTier)};\n\n`);
    await w(`export const officialTraitStatsByTier = ${stableJson(officialTraitStatsByTier)};\n\n`);
    await w(`export const officialTraitBuildStatsByTier = ${stableJson(officialTraitBuildStatsByTier)};\n\n`);
    await w(`export const officialPairStatsByTier = ${stableJson(officialPairStatsByTier)};\n\n`);
    await w(`export const officialCombatStatsByTier = ${stableJson(officialCombatStatsByTier)};\n\n`);
    await w(`export const OFFICIAL_V2_WEIGHTS = {\n  characterPower: 0.30,\n  pairSynergy:    0.35,\n  combatScore:    0.15,\n  roleBalance:    0.20,\n};\n\n`);
    await w(`export const BAYESIAN_ALPHA = {\n  character: 100,\n  pair:       80,\n  combat:     80,\n};\n\n`);
    await w(`export function officialStatsBucketForTier(tier = "all") {\n  const bucketMap = {\n    all: "all",\n    iron_gold: "iron_gold",\n    platinum_diamond: "platinum_diamond",\n    meteor_mithril: "meteor_mithril",\n    demigod_eternity: "demigod_eternity",\n    iron_bronze: "iron_gold",\n    silver_gold: "iron_gold",\n    diamond: "platinum_diamond",\n    mithril_plus: "meteor_mithril",\n  };\n  const preferred = bucketMap[tier] ?? tier ?? "all";\n  if (officialCandidateStatsByTier[preferred] || officialCompositionStatsByTier[preferred] || officialTraitBuildStatsByTier[preferred]) return preferred;\n  return "all";\n}\n`);
    await new Promise((res, rej) => ws.end((e) => e ? rej(e) : res()));
  }

  // Also write JSON for remote fetch
  const jsonPayload = {
    source, officialCandidateStatsByTier, officialCompositionStatsByTier,
    officialTraitStatsByTier, officialTraitBuildStatsByTier,
    officialPairStatsByTier, officialCombatStatsByTier,
    weights: { characterPower: 0.30, pairSynergy: 0.35, combatScore: 0.15, roleBalance: 0.20 },
    alpha:   { character: 100, pair: 80, combat: 80 },
  };
  await fs.writeFile(args.jsonOut, JSON.stringify(jsonPayload), "utf8");

  console.log(`saved JS: ${path.relative(ROOT, args.out)}`);
  console.log(`saved JSON: ${path.relative(ROOT, args.jsonOut)}`);
  const droppedTeams = allTeams.length - validTeams;
  console.log(JSON.stringify({
    rawTeams: allTeams.length,
    mappedTeams,
    validTeams,
    droppedTeams,
    dropReasons: { unknownChar: droppedByUnknownChar, invalidSize: droppedByInvalidSize },
    unknownCharacterCodes: source.unmappedCharacterCodes,
  }, null, 2));
}
build().catch((error) => {
  console.error(error);
  process.exit(1);
});
