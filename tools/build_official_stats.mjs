import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import readline from "node:readline";
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
    .replace(/[&.\-_\s']/g, "");
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
    ["xiukai", "sho"],
    ["jan", "yan"],
    ["justyna", "justina"],
    ["niah", "nia"],
    ["lyanh", "ian"],
    ["xuelin", "shirin"],
    ["coraline", "coreline"],
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

  const index = localNameIndex();
  let officialRows = 0;
  let officialMapped = 0;

  for (const version of ["v2", "v1"]) {
    try {
      const payload = await fetchJson(`/${version}/data/Character`, `data:${version}:Character`);
      const rows = flattenRows(payload);
      officialRows += rows.length;

      let mappedInVersion = 0;
      let unmappedInVersion = 0;
      const unmappedNames = [];

      for (const row of rows) {
        const code = firstValue(row, ["code", "characterCode", "characterNum", "id", "key"]);
        const name = firstValue(row, ["name", "nameKr", "nameKo", "nameKor", "characterName", "korName"]);
        const localId = index.get(normalizeName(name));
        if (code !== undefined && localId) {
          codeMap.set(String(code), localId);
          mappedInVersion += 1;
        } else if (code !== undefined || name) {
          if (code !== undefined) codeMap.delete(String(code));
          unmappedInVersion += 1;
          if (unmappedNames.length < 8) unmappedNames.push(`${code ?? "?"}:${name ?? "?"}`);
        }
      }

      officialMapped += mappedInVersion;
      const note = unmappedNames.length ? `; unmapped ${unmappedInVersion}: ${unmappedNames.join(", ")}` : "";
      console.log(`Character map ${version}: ${mappedInVersion}/${rows.length} rows mapped${note}`);
    } catch (error) {
      console.warn(`official character data fetch skipped for ${version}/Character: ${error.message}`);
    }
  }

  if (officialRows === 0) {
    console.warn("official character data unavailable; using fallback character code map only");
  } else if (officialMapped < 80) {
    console.warn(`official character map covered only ${officialMapped} rows; newer character codes may still rely on fallback`);
  }

  return codeMap;
}

// Verified trait code -> Korean name map.
// Source: user ground truth + l10n discovery (2026-06).
// The /v1/data/Trait API often lacks name fields, so l10n is preferred and
// this map is kept as a safe fallback when the l10n fetch fails.
const KNOWN_TRAIT_CODE_NAMES = new Map([
  ["7000201", "취약"],
  ["7000401", "흡혈마"],
  ["7000501", "벽력"],
  ["7000601", "아드레날린"],
  ["7000701", "액셀러레이터"],
  ["7100101", "금강"],
  ["7100201", "불괴"],
  ["7100401", "빛의 수호"],
  ["7100501", "응징"],
  ["7200101", "초재생"],
  ["7200201", "증폭 드론"],
  ["7200301", "치유 드론"],
  ["7200501", "헌신"],
  ["7300101", "스텔라 차지"],
  ["7300201", "도깨비불"],
  ["7300301", "와류"],
])

/** Parse trait code/name rows from an ER l10n file.
 *  Format: key + U+2503 BOX DRAWINGS HEAVY VERTICAL + value.
 *  Name lines: Trait/Name/<code> + separator + localized name.
 */
function parseTraitNamesFromL10n(text) {
  const SEP = "\u2503"; // U+2503
  const result = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("Trait/Name/")) continue;
    const sepIdx = line.indexOf(SEP);
    if (sepIdx === -1) continue;
    const key  = line.slice(0, sepIdx);          // e.g. "Trait/Name/7300301"
    const name = line.slice(sepIdx + 1).trim();  // e.g. "??"
    if (!name) continue;
    // Key is exactly "Trait/Name/<7-digit-code>"
    const m = key.match(/^Trait\/Name\/(7[0-3]\d{5})$/);
    if (m && !result.has(m[1])) result.set(m[1], name);
  }
  return result;
}

async function buildTraitNameMap(fetchData) {
  // Start with the verified hardcoded map so the build is always correct
  // even when the API is unavailable or returns unexpected data.
  const map = new Map(KNOWN_TRAIT_CODE_NAMES);
  if (!fetchData) return map;

  // 1) Try l10n file (authoritative Korean names, overrides hardcoded if found)
  try {
    const l10nMeta = await fetchJson("/v1/l10n/Korean", "l10n:Korean");
    // ER API envelope: fetchJson already unwraps .data, so l10nMeta = { l10Path: "https://..." }
    // but guard against double-unwrap by also checking .data.l10Path
    const l10nInner = l10nMeta?.l10Path ? l10nMeta : (l10nMeta?.data ?? l10nMeta);
    const l10nUrl = l10nInner?.l10Path ?? l10nInner?.url ?? (typeof l10nInner === "string" ? l10nInner : undefined);
    if (l10nUrl) {
      const l10nText = await (await fetch(l10nUrl)).text();
      const l10nMap = parseTraitNamesFromL10n(l10nText);
      for (const [code, name] of l10nMap) map.set(code, name);
      console.log(`L10n trait names: ${l10nMap.size} loaded`);
    }
  } catch (err) {
    console.warn("L10n trait name fetch failed (using hardcoded fallback):", err.message);
  }

  // 2) Try data API in case a future API version adds name fields.
  for (const [version, table] of [["v2", "Trait"], ["v1", "Trait"]]) {
    try {
      const payload = await fetchJson(`/${version}/data/${table}`, `data:${version}:${table}`);
      for (const row of flattenCodeRows(payload)) {
        const code = firstValue(row, ["code", "traitCode", "id", "key"]);
        const name = firstValue(row, ["name", "nameKr", "nameKo", "traitName", "korName"]);
        if (code !== undefined && name && !map.has(String(code))) map.set(String(code), String(name));
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

const CHARACTER_WEAPON_CODE_OVERRIDES = {
  sho: {
    15: "dagger",
    19: "spear",
  },
};

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

  const weapon =
    CHARACTER_WEAPON_CODE_OVERRIDES[player.characterId]?.[String(player.weapon)] ??
    weaponCodeToId.get(String(player.weapon));
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
      healAmount: 0,
      protectAbsorb: 0,
      kills: 0,
      assists: 0,
      teamKills: 0,
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
  stat.healAmount += numeric(playerStats.healAmount);
  stat.protectAbsorb += numeric(playerStats.protectAbsorb);
  stat.kills += numeric(playerStats.kills);
  stat.assists += numeric(playerStats.assists);
  stat.teamKills += numeric(playerStats.teamKills);
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
      healAmount: 0,
      protectAbsorb: 0,
      kills: 0,
      assists: 0,
      teamKills: 0,
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
  stat.healAmount += numeric(playerStats.healAmount);
  stat.protectAbsorb += numeric(playerStats.protectAbsorb);
  stat.kills += numeric(playerStats.kills);
  stat.assists += numeric(playerStats.assists);
  stat.teamKills += numeric(playerStats.teamKills);
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
      avgHealAmount: Math.round(stat.healAmount / stat.games),
      avgProtectAbsorb: Math.round(stat.protectAbsorb / stat.games),
      avgKills: round(stat.kills / stat.games, 2),
      avgAssists: round(stat.assists / stat.games, 2),
      avgTeamKills: round(stat.teamKills / stat.games, 2),
      killParticipation: round((stat.kills + stat.assists) / Math.max(1, stat.teamKills), 3),
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
        avgHealAmount: Math.round(stat.healAmount / stat.games),
        avgProtectAbsorb: Math.round(stat.protectAbsorb / stat.games),
        avgKills: round(stat.kills / stat.games, 2),
        avgAssists: round(stat.assists / stat.games, 2),
        avgTeamKills: round(stat.teamKills / stat.games, 2),
        killParticipation: round((stat.kills + stat.assists) / Math.max(1, stat.teamKills), 3),
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

function clamp01(value, max = 1.3) {
  return Math.max(0, Math.min(max, Number(value) || 0));
}

function div(a, b, fallback = 0) {
  return b ? a / b : fallback;
}

function globalAverageFromCandidateSource(source = {}) {
  const totals = Object.values(source).reduce((state, stat) => {
    const games = stat.games ?? 0;
    state.games += games;
    state.avgPlacement += stat.placementSum;
    state.placementGames += stat.placementGames;
    state.top3 += stat.top3;
    state.damageToPlayer += stat.damageToPlayer;
    state.damageFromPlayer += stat.damageFromPlayer;
    state.ccTime += stat.ccTime;
    state.healAmount += stat.healAmount;
    state.protectAbsorb += stat.protectAbsorb;
    state.kills += stat.kills;
    state.assists += stat.assists;
    state.teamKills += stat.teamKills;
    return state;
  }, {
    games: 0,
    avgPlacement: 0,
    placementGames: 0,
    top3: 0,
    damageToPlayer: 0,
    damageFromPlayer: 0,
    ccTime: 0,
    healAmount: 0,
    protectAbsorb: 0,
    kills: 0,
    assists: 0,
    teamKills: 0,
  });

  return {
    games: totals.games,
    top3Rate: div(totals.top3, totals.games),
    avgPlacement: div(totals.avgPlacement, totals.placementGames, 4.3),
    avgDamageToPlayer: div(totals.damageToPlayer, totals.games, 1),
    avgDamageFromPlayer: div(totals.damageFromPlayer, totals.games, 1),
    avgCcTime: div(totals.ccTime, totals.games, 1),
    avgHealAmount: div(totals.healAmount, totals.games, 1),
    avgProtectAbsorb: div(totals.protectAbsorb, totals.games, 1),
    avgKills: div(totals.kills, totals.games, 1),
    killParticipation: div(totals.kills + totals.assists, Math.max(1, totals.teamKills), 1),
  };
}

function empiricalVectorFromRow(row, globalAvg, variant) {
  const damageRatio = div(row.avgDamageToPlayer, globalAvg.avgDamageToPlayer, 1);
  const takenRatio = div(row.avgDamageFromPlayer, globalAvg.avgDamageFromPlayer, 1);
  const ccRatio = div(row.avgCcTime, globalAvg.avgCcTime, 1);
  const healRatio = div(row.avgHealAmount, globalAvg.avgHealAmount, 1);
  const protectRatio = div(row.avgProtectAbsorb, globalAvg.avgProtectAbsorb, 1);
  const tempoRatio = div(row.killParticipation, globalAvg.killParticipation, 1);
  const placement = row.avgPlacement ?? globalAvg.avgPlacement;
  const stabilityRatio = (div(row.top3Rate, globalAvg.top3Rate, 1) + div(globalAvg.avgPlacement, placement, 1)) / 2;
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
    frontline: round(clamp01(takenRatio * 0.68 + melee + frontRole), 3),
    damage: round(clamp01(damageRatio * 0.82 + tempoRatio * 0.18), 3),
    durability: round(clamp01(takenRatio * 0.58 + stabilityRatio * 0.24 + healRatio * 0.10 + protectRatio * 0.08), 3),
    cc: round(clamp01(ccRatio), 3),
    support: round(clamp01(supportStatMass + supportPrior + ccRatio * 0.03), 3),
    sustain: round(clamp01(healRatio * 0.40 + protectRatio * 0.12 + takenRatio * 0.22 + stabilityRatio * 0.18 + tempoRatio * 0.08), 3),
    tempo: round(clamp01(tempoRatio * 0.75 + div(row.avgKills, globalAvg.avgKills, 1) * 0.25), 3),
    stability: round(clamp01(stabilityRatio), 3),
  };
}

function finalizeEmpiricalVectorStats(candidateStatsByTier, traitBuildStatsByTier, sourceByTier) {
  const output = {};
  for (const bucket of Object.keys(candidateStatsByTier).sort()) {
    const globalAvg = globalAverageFromCandidateSource(sourceByTier[bucket] ?? {});
    const rows = {};
    for (const [variantId, row] of Object.entries(candidateStatsByTier[bucket] ?? {})) {
      const variant = characterVariants.find((item) => item.variantId === variantId);
      if (!variant) continue;
      rows[variantId] = {
        games: row.games,
        vector: empiricalVectorFromRow(row, globalAvg, variant),
      };
    }
    for (const [variantId, builds] of Object.entries(traitBuildStatsByTier[bucket] ?? {})) {
      const variant = characterVariants.find((item) => item.variantId === variantId);
      if (!variant) continue;
      for (const row of builds ?? []) {
        if (!row.core) continue;
        rows[`${variantId}#${row.core}`] = {
          games: row.games,
          core: row.core,
          vector: empiricalVectorFromRow(row, globalAvg, variant),
        };
      }
    }
    output[bucket] = rows;
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


// Recency decay. Weight older games lower within a patch.
// lambda=0.02 means roughly 50% weight at 35 days.
function recencyWeight(collectedAt, lambda = 0.02) {
  if (!collectedAt) return 1;
  const daysAgo = (Date.now() - new Date(collectedAt).getTime()) / 86400000;
  return Math.exp(-lambda * Math.max(0, daysAgo));
}

// Pair stats.
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

// Combat stats.
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

  // Merge teams from all input files (dedup by gameId:teamKey). Supports JSONL (.jsonl,
  // streamed line-by-line so an unbounded corpus avoids the ~512MB string limit) and the
  // legacy wrapped-JSON format ({ teams: [...] }).
  const dedupKeys = new Set();
  const allTeams = [];
  const pushTeam = (team) => {
    const key = `${team.gameId}:${team.teamKey}`;
    if (dedupKeys.has(key)) return;
    dedupKeys.add(key);
    allTeams.push(team);
  };
  for (const inPath of args.in) {
    const before = allTeams.length;
    if (inPath.endsWith(".jsonl")) {
      try {
        const rl = readline.createInterface({ input: createReadStream(inPath, { encoding: "utf8" }), crlfDelay: Infinity });
        for await (const line of rl) {
          if (!line.trim()) continue;
          try { pushTeam(JSON.parse(line)); } catch { /* skip malformed line */ }
        }
      } catch { console.warn(`WARNING: could not read ${inPath}, skipping`); continue; }
    } else {
      let data;
      try { data = JSON.parse(await fs.readFile(inPath, "utf8")); }
      catch { console.warn(`WARNING: could not read ${inPath}, skipping`); continue; }
      for (const team of data.teams ?? []) pushTeam(team);
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
  let officialEmpiricalVectorStatsByTier = {};
  const allBuckets = new Set([...Object.keys(candidateByTier), ...Object.keys(traitBuildByTier), ...Object.keys(pairByTier)]);
  for (const bucket of [...allBuckets].sort()) {
    officialCandidateStatsByTier[bucket] = finalizeCandidateStats(candidateByTier[bucket] ?? {}, args.minGames);
    officialTraitStatsByTier[bucket]     = finalizeTraitStats(candidateByTier[bucket] ?? {}, args.minGames, traitNameMap);
    officialTraitBuildStatsByTier[bucket] = finalizeTraitBuildStats(traitBuildByTier[bucket] ?? {}, args.minGames, traitNameMap);
    officialCompositionStatsByTier[bucket] = finalizeCompositionStats(compositionByTier[bucket] ?? {}, args.minGames);
    officialPairStatsByTier[bucket]      = finalizePairStats(pairByTier[bucket] ?? {}, args.minGames);
    officialCombatStatsByTier[bucket]    = finalizeCombatStats(combatByTier[bucket] ?? {}, args.minGames);
  }
  officialEmpiricalVectorStatsByTier = finalizeEmpiricalVectorStats(
    officialCandidateStatsByTier,
    officialTraitBuildStatsByTier,
    candidateByTier,
  );

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
    await w(`export const officialEmpiricalVectorStatsByTier = ${stableJson(officialEmpiricalVectorStatsByTier)};\n\n`);
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
    officialEmpiricalVectorStatsByTier,
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
