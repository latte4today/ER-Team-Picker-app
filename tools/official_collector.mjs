import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireEnv } from "./env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BASE_URL = process.env.ER_API_BASE_URL?.trim() || "https://open-api.bser.io";
const CACHE_DIR = path.join(ROOT, "data", "official-cache");
const DEFAULT_OUT = path.join(ROOT, "data", "official-match-input.json");

const SEEDS_FILE = path.join(ROOT, "data", "tier_seeds.json");

const DEFAULTS = {
  season: 39,
  teamMode: 3,
  matchingMode: 3,
  rankers: 20,
  gamesPerUser: 10,
  seedsFile: SEEDS_FILE,
  seedsGamesPerUser: 15,
  delayMs: 1500,
  retry429Ms: 20000,
  out: DEFAULT_OUT,
};

function parseArgs() {
  const args = { ...DEFAULTS };
  const aliases = {
    "team-mode": "teamMode",
    "matching-mode": "matchingMode",
    "games-per-user": "gamesPerUser",
    "delay-ms": "delayMs",
    "retry-429-ms": "retry429Ms",
  };

  for (let index = 2; index < process.argv.length; index += 1) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (!key.startsWith("--")) continue;
    index += 1;
    const option = aliases[key.slice(2)] ?? key.slice(2);
    if (["season", "teamMode", "matchingMode", "rankers", "gamesPerUser", "delayMs", "retry429Ms"].includes(option)) {
      args[option] = Number(value);
    } else if (option === "out") {
      args.out = path.resolve(ROOT, value);
    } else if (option === "seeds-file") {
      args.seedsFile = path.resolve(ROOT, value);
    } else {
      args[option] = value;
    }
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function makeClient(apiKey, delayMs, retry429Ms) {
  const headers = { "x-api-key": apiKey };
  const sanitizeEndpoint = (endpoint) => endpoint.replace(/\/uid\/[^/?]+/g, "/uid/[redacted]");

  async function getJson(endpoint, { cacheKey, cache = true } = {}) {
    if (cache && cacheKey) {
      const cached = await readCache(cacheKey);
      if (cached) return cached;
    }

    let response = await fetch(`${BASE_URL}${endpoint}`, { headers });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : retry429Ms;
      console.log(`rate limited: waiting ${Math.round(waitMs / 1000)}s`);
      await sleep(waitMs);
      response = await fetch(`${BASE_URL}${endpoint}`, { headers });
      const retryText = await response.text();
      try {
        payload = retryText ? JSON.parse(retryText) : {};
      } catch {
        payload = { raw: retryText };
      }
    }

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${sanitizeEndpoint(endpoint)} ${text.slice(0, 300)}`);
    }

    if (cache && cacheKey) await writeCache(cacheKey, payload);
    if (delayMs > 0) await sleep(delayMs);
    return payload;
  }

  return { getJson };
}

function firstValue(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function rankRows(payload) {
  return payload?.topRanks ?? payload?.userRankList ?? payload?.ranks ?? [];
}

function nicknameOf(row) {
  return firstValue(row, ["nickname", "nickName", "name"]);
}

function rankInfoRows(payload) {
  const candidates = [
    payload?.userRank,
    payload?.rank,
    payload?.rankInfo,
    payload?.userRankInfo,
    payload?.userStats,
    payload?.data,
    payload?.user,
    payload,
  ];
  return candidates.flatMap((candidate) => {
    if (!candidate) return [];
    return Array.isArray(candidate) ? candidate : [candidate];
  });
}

function numericValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function tierBucketFromText(value) {
  const text = String(value ?? "").toLowerCase();
  if (!text) return undefined;
  if (text.includes("iron") || text.includes("bronze")) return "bronze";
  if (text.includes("silver")) return "silver";
  if (text.includes("gold")) return "gold";
  if (text.includes("platinum")) return "platinum";
  if (text.includes("diamond")) return "diamond";
  if (text.includes("meteorite") || text.includes("mithril") || text.includes("titan") || text.includes("immortal") || text.includes("demigod") || text.includes("eternity")) {
    return "mithril_plus";
  }
  return undefined;
}

function tierBucketFromMmr(mmr) {
  const value = numericValue(mmr);
  if (value === undefined) return undefined;
  if (value >= 9000) return "mithril_plus";
  if (value >= 7000) return "diamond";
  if (value >= 5200) return "platinum";
  if (value >= 3600) return "gold";
  if (value >= 2000) return "silver";
  return "bronze";
}

function extractRankInfo(payload) {
  for (const row of rankInfoRows(payload)) {
    const tierText = firstValue(row, ["tier", "tierName", "tierType", "tier_type", "rankTier", "rank_tier"]);
    const mmr = firstValue(row, ["mmr", "rankMmr", "rank_mmr"]);
    const bucket = tierBucketFromText(tierText) ?? tierBucketFromMmr(mmr);
    if (tierText !== undefined || mmr !== undefined || bucket) {
      return {
        tier: tierText,
        tierBucket: bucket ?? "unknown",
        mmr: numericValue(mmr),
        rank: firstValue(row, ["rank", "ranking", "rankNumber", "rank_number"]),
      };
    }
  }
  return { tierBucket: "unknown" };
}

function userIdOf(value) {
  if (!value || typeof value !== "object") return undefined;
  const direct = firstValue(value, ["userId", "user_id", "uid"]);
  if (direct) return direct;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = userIdOf(item);
      if (found) return found;
    }
    return undefined;
  }
  for (const item of Object.values(value)) {
    const found = userIdOf(item);
    if (found) return found;
  }
  return undefined;
}

async function lookupUserId(client, nickname) {
  const encoded = encodeURIComponent(nickname);
  const candidates = [
    `/v1/user/nickname?query=${encoded}`,
    `/v1/user/nickname/${encoded}`,
    `/v1/user?nickname=${encoded}`,
  ];

  for (const endpoint of candidates) {
    try {
      // Do not cache nickname lookup results. The API intentionally returns
      // non-stable user identifiers to prevent persistent user tracking.
      const payload = await client.getJson(endpoint, { cache: false });
      const userId = userIdOf(payload);
      if (userId) return userId;
    } catch {
      // Try the next known endpoint shape.
    }
  }
  return undefined;
}

async function lookupRankInfo(client, userId, season, teamMode) {
  try {
    const payload = await client.getJson(`/v1/rank/uid/${encodeURIComponent(userId)}/${season}/${teamMode}`, { cache: false });
    return extractRankInfo(payload);
  } catch {
    return { tierBucket: "unknown" };
  }
}

function gameRows(payload) {
  return payload?.userGames ?? payload?.games ?? payload?.gameDetails ?? payload?.data ?? [];
}

function gameIdOf(row) {
  return firstValue(row, ["gameId", "game_id"]);
}

function teamKeyOf(row) {
  return firstValue(row, ["teamNumber", "team_number", "teamId", "team_id", "team"]);
}

function characterOf(row) {
  return firstValue(row, ["characterNum", "character_num", "characterCode", "character_code"]);
}

function weaponOf(row) {
  return firstValue(row, [
    "bestWeapon",
    "best_weapon",
    "weapon",
    "weaponCode",
    "weapon_code",
    "weaponType",
    "weapon_type",
    "equipmentWeapon",
  ]);
}

function compactStatFields(row) {
  return {
    kills: Number(firstValue(row, ["playerKill", "player_kill", "kills"]) ?? 0),
    assists: Number(firstValue(row, ["playerAssistant", "player_assistant", "assists"]) ?? 0),
    teamKills: Number(firstValue(row, ["teamKill", "team_kill"]) ?? 0),
    damageToPlayer: Number(firstValue(row, ["damageToPlayer", "damage_to_player", "totalDamageToPlayer"]) ?? 0),
    damageToPlayerBasic: Number(firstValue(row, ["damageToPlayer_basic"]) ?? 0),
    damageToPlayerSkill: Number(firstValue(row, ["damageToPlayer_skill"]) ?? 0),
    damageToPlayerItemSkill: Number(firstValue(row, ["damageToPlayer_itemSkill"]) ?? 0),
    damageToPlayerDirect: Number(firstValue(row, ["damageToPlayer_direct"]) ?? 0),
    damageToPlayerUniqueSkill: Number(firstValue(row, ["damageToPlayer_uniqueSkill"]) ?? 0),
    damageFromPlayer: Number(firstValue(row, ["damageFromPlayer", "damage_from_player", "totalDamageFromPlayer"]) ?? 0),
    damageFromPlayerBasic: Number(firstValue(row, ["damageFromPlayer_basic"]) ?? 0),
    damageFromPlayerSkill: Number(firstValue(row, ["damageFromPlayer_skill"]) ?? 0),
    shieldedPlayerDamage: Number(firstValue(row, ["damageOffsetedByShield_Player"]) ?? 0),
    ccCount: Number(firstValue(row, ["ccCount", "cc_count", "crowdControlCount", "crowd_control_count"]) ?? 0),
    ccTime: Number(firstValue(row, ["ccTimeToPlayer", "ccTime", "cc_time", "crowdControlTime", "crowd_control_time"]) ?? 0),
    healAmount: Number(firstValue(row, ["healAmount", "heal_amount"]) ?? 0),
    protectAbsorb: Number(firstValue(row, ["protectAbsorb", "protect_absorb"]) ?? 0),
    visionScore: Number(firstValue(row, ["sightScore", "visionScore", "vision_score"]) ?? 0),
    viewContribution: Number(firstValue(row, ["viewContribution", "view_contribution"]) ?? 0),
  };
}

function traitInfoOf(row) {
  const traits = {};
  for (const [targetKey, sourceKeys] of Object.entries({
    core: ["traitFirstCore", "trait_first_core", "traitCore", "trait_core"],
    firstSub: ["traitFirstSub", "trait_first_sub", "traitSub1", "trait_sub_1"],
    secondSub: ["traitSecondSub", "trait_second_sub", "traitSub2", "trait_sub_2"],
    tacticalSkill: ["tacticalSkillGroup", "tactical_skill_group", "tacticalSkill", "tactical_skill"],
    tacticalSkillLevel: ["tacticalSkillLevel", "tactical_skill_level"],
  })) {
    const value = firstValue(row, sourceKeys);
    if (value !== undefined) traits[targetKey] = value;
  }
  return traits;
}

function normalizePlayer(row) {
  return {
    character: characterOf(row),
    weapon: weaponOf(row),
    traits: traitInfoOf(row),
    stats: compactStatFields(row),
    gameRank: firstValue(row, ["gameRank", "game_rank"]),
    rankPoint: firstValue(row, ["rankPoint", "rank_point"]),
    mmrGain: firstValue(row, ["mmrGainInGame", "mmr_gain_in_game"]),
    mmr: firstValue(row, ["mmr", "mmrAfter", "mmr_after"]),
  };
}

function normalizeGame(gameId, payload, sourceRankInfo) {
  const rows = gameRows(payload);
  const teamMap = new Map();
  for (const row of rows) {
    const teamKey = teamKeyOf(row);
    const character = characterOf(row);
    if (teamKey === undefined || character === undefined) continue;
    const key = String(teamKey);
    if (!teamMap.has(key)) {
      teamMap.set(key, {
        gameId,
        teamKey: key,
        rank: firstValue(row, ["gameRank", "game_rank"]),
        victory: Boolean(firstValue(row, ["victory"])),
        tier: sourceRankInfo?.tier,
        tierBucket: sourceRankInfo?.tierBucket ?? "unknown",
        sourceRankMmr: sourceRankInfo?.mmr,
        matchingMode: firstValue(row, ["matchingMode", "matching_mode"]),
        matchingTeamMode: firstValue(row, ["matchingTeamMode", "matching_team_mode"]),
        seasonId: firstValue(row, ["seasonId", "season_id"]),
        players: [],
      });
    }
    teamMap.get(key).players.push(normalizePlayer(row));
  }

  return [...teamMap.values()].filter((team) => team.players.length >= 2);
}

// ── Shared: nickname → gameIds collector (used by both ranker and seed modes) ──
async function collectGameIdsFromNicknames(client, nicknames, tierBucket, gamesPerUser, gameIds, gameRankInfo, label) {
  let ok = 0;
  for (const [index, nickname] of nicknames.entries()) {
    const userId = await lookupUserId(client, nickname);
    if (!userId) {
      console.log(`  [${label}] ${index + 1}/${nicknames.length} "${nickname}": lookup failed`);
      continue;
    }
    const rankInfo = { tierBucket };
    const gamesPayload = await client.getJson(`/v1/user/games/uid/${encodeURIComponent(userId)}`, { cache: false });
    const ids = gameRows(gamesPayload).map(gameIdOf).filter(Boolean).slice(0, gamesPerUser);
    ids.forEach((id) => {
      gameIds.add(id);
      if (!gameRankInfo.has(String(id))) gameRankInfo.set(String(id), rankInfo);
    });
    ok++;
    console.log(`  [${label}] ${index + 1}/${nicknames.length} "${nickname}": ${ids.length} games  (unique total: ${gameIds.size})`);
  }
  return ok;
}

async function collect() {
  const options = parseArgs();
  const apiKey = requireEnv("ER_API_KEY");
  const client = makeClient(apiKey, options.delayMs, options.retry429Ms);

  const gameIds = new Set();
  const gameRankInfo = new Map();

  // ── 1. Top-ranker collection (demigod_eternity) ──────────────────────────
  console.log(`\n[demigod_eternity] fetching top ${options.rankers} rankers from API...`);
  const rankPayload = await client.getJson(`/v1/rank/top/${options.season}/${options.teamMode}`, {
    cacheKey: `rank-top:${options.season}:${options.teamMode}`,
  });
  const rankerNicknames = rankRows(rankPayload).map(nicknameOf).filter(Boolean).slice(0, options.rankers);
  await collectGameIdsFromNicknames(
    client, rankerNicknames, "demigod_eternity",
    options.gamesPerUser, gameIds, gameRankInfo, "demigod_eternity"
  );

  // ── 2. Seed-based collection (lower tiers) ───────────────────────────────
  let seeds = {};
  try {
    seeds = JSON.parse(await fs.readFile(options.seedsFile, "utf8"));
    console.log(`\n[seeds] loaded from ${path.relative(ROOT, options.seedsFile)}: tiers = ${Object.keys(seeds).join(", ")}`);
  } catch {
    console.log(`\n[seeds] no seeds file found at ${options.seedsFile}, skipping seed collection`);
  }

  for (const [tierBucket, nicknames] of Object.entries(seeds)) {
    console.log(`\n[${tierBucket}] ${nicknames.length} seeds, ${options.seedsGamesPerUser} games each`);
    await collectGameIdsFromNicknames(
      client, nicknames, tierBucket,
      options.seedsGamesPerUser, gameIds, gameRankInfo, tierBucket
    );
  }

  // ── 3. Fetch all unique games ────────────────────────────────────────────
  console.log(`\n[games] fetching ${gameIds.size} unique games...`);
  const teams = [];
  for (const [index, gameId] of [...gameIds].entries()) {
    const payload = await client.getJson(`/v1/games/${gameId}`, { cacheKey: `game:${gameId}` });
    teams.push(...normalizeGame(gameId, payload, gameRankInfo.get(String(gameId))));
    if ((index + 1) % 10 === 0 || index + 1 === gameIds.size) {
      console.log(`  game ${index + 1}/${gameIds.size}: ${teams.length} teams so far`);
    }
  }

  // ── 4. Summary ────────────────────────────────────────────────────────────
  const byTier = {};
  for (const team of teams) {
    byTier[team.tierBucket] = (byTier[team.tierBucket] ?? 0) + 1;
  }
  console.log("\n[summary] teams by tier:", byTier);

  const output = {
    generatedAt: new Date().toISOString(),
    source: "official-api",
    options: {
      season: options.season,
      teamMode: options.teamMode,
      rankers: options.rankers,
      gamesPerUser: options.gamesPerUser,
      seedsGamesPerUser: options.seedsGamesPerUser,
    },
    privacy: {
      storesNicknames: false,
      storesUserIds: false,
      note: "Nickname lookup userIds are used only during the current collection run and are not written to output.",
    },
    tierBreakdown: byTier,
    teams,
  };

  await fs.mkdir(path.dirname(options.out), { recursive: true });
  await fs.writeFile(options.out, JSON.stringify(output, null, 2), "utf8");
  console.log(`\nsaved: ${path.relative(ROOT, options.out)} (${teams.length} total teams)`);
}

collect().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
