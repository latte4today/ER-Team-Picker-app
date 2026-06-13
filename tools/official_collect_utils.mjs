/**
 * official_collect_utils.mjs
 * Shared utilities for official API collectors.
 */

import fs from "node:fs/promises";
import path from "node:path";

// ── HTTP client ──────────────────────────────────────────────────────────────

export function makeClient(apiKey, baseUrl, delayMs, retry429Ms) {
  const headers = { "x-api-key": apiKey };
  const CACHE_DIR = path.resolve("data", "official-cache");

  function cacheName(key) {
    return Buffer.from(key).toString("base64url") + ".json";
  }

  async function readCache(key) {
    try {
      return JSON.parse(await fs.readFile(path.join(CACHE_DIR, cacheName(key)), "utf8"));
    } catch { return undefined; }
  }

  async function writeCache(key, payload) {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(path.join(CACHE_DIR, cacheName(key)), JSON.stringify(payload), "utf8");
  }

  async function getJson(endpoint, { cacheKey, cache = true } = {}) {
    if (cache && cacheKey) {
      const cached = await readCache(cacheKey);
      if (cached) return cached;
    }

    let res = await fetch(`${baseUrl}${endpoint}`, { headers });
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : retry429Ms;
      console.log(`  rate-limited: waiting ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      res = await fetch(`${baseUrl}${endpoint}`, { headers });
    }

    const text = await res.text();
    let payload;
    try { payload = text ? JSON.parse(text) : {}; }
    catch { payload = { raw: text }; }

    if (!res.ok) throw new Error(`${res.status}: ${endpoint.replace(/\/uid\/[^/?]+/g, "/uid/[…]")} — ${text.slice(0, 200)}`);
    if (cache && cacheKey) await writeCache(cacheKey, payload);
    if (delayMs > 0) await sleep(delayMs);
    return payload;
  }

  return { getJson };
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Field extractors ─────────────────────────────────────────────────────────

export function firstValue(row, keys) {
  for (const key of keys) {
    const v = row?.[key];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

export function gameRows(payload) {
  return payload?.userGames ?? payload?.games ?? payload?.gameDetails ?? payload?.data ?? [];
}

export function gameIdOf(row) {
  return firstValue(row, ["gameId", "game_id"]);
}

export function teamKeyOf(row) {
  return firstValue(row, ["teamNumber", "team_number", "teamId", "team_id", "team"]);
}

export function characterOf(row) {
  return firstValue(row, ["characterNum", "character_num", "characterCode", "character_code"]);
}

export function weaponOf(row) {
  return firstValue(row, ["bestWeapon", "best_weapon", "weapon", "weaponCode", "weapon_code", "weaponType", "weapon_type", "equipmentWeapon"]);
}

export function nicknameOf(row) {
  return firstValue(row, ["nickname", "nickName", "name"]);
}

export function rankRows(payload) {
  return payload?.topRanks ?? payload?.userRankList ?? payload?.ranks ?? [];
}

// ── Tier mapping ─────────────────────────────────────────────────────────────

export function tierBucketFromText(value) {
  const text = String(value ?? "").toLowerCase();
  if (!text) return undefined;
  if (text.includes("iron") || text.includes("bronze")) return "bronze";
  if (text.includes("silver")) return "silver";
  if (text.includes("gold")) return "gold";
  if (text.includes("platinum")) return "platinum";
  if (text.includes("diamond")) return "diamond";
  if (text.includes("meteorite") || text.includes("meteor")) return "meteor";
  if (text.includes("mithril")) return "mithril";
  if (text.includes("demigod") || text.includes("demi")) return "demigod";
  if (text.includes("eternity")) return "eternity";
  if (text.includes("titan") || text.includes("immortal")) return "mithril_plus";
  return undefined;
}

export function tierBucketFromMmr(mmr) {
  const v = Number(mmr);
  if (!Number.isFinite(v)) return undefined;
  if (v >= 14000) return "eternity";
  if (v >= 11000) return "demigod";
  if (v >= 9000)  return "mithril";
  if (v >= 7500)  return "meteor";
  if (v >= 6000)  return "diamond";
  if (v >= 4500)  return "platinum";
  if (v >= 3000)  return "gold";
  if (v >= 1500)  return "silver";
  return "bronze";
}

/** Collapse fine-grained buckets into the 4 seed tiers. */
export function compactTierBucket(bucket) {
  if (["bronze", "silver", "gold"].includes(bucket)) return "iron_gold";
  if (["platinum", "diamond"].includes(bucket))       return "platinum_diamond";
  if (["meteor", "mithril"].includes(bucket))         return "meteor_mithril";
  if (["demigod", "eternity"].includes(bucket))       return "demigod_eternity";
  if (bucket === "mithril_plus")                      return "meteor_mithril";
  return bucket ?? "unknown";
}

function rankInfoRows(payload) {
  return [
    payload?.userRank, payload?.rank, payload?.rankInfo,
    payload?.userRankInfo, payload?.userStats, payload?.data, payload?.user, payload,
  ].flatMap((c) => !c ? [] : Array.isArray(c) ? c : [c]);
}

export function extractRankInfo(payload) {
  for (const row of rankInfoRows(payload)) {
    const tierText = firstValue(row, ["tier", "tierName", "tierType", "rankTier"]);
    const mmr      = firstValue(row, ["mmr", "rankMmr"]);
    const fine = tierBucketFromText(tierText) ?? tierBucketFromMmr(mmr);
    if (tierText !== undefined || mmr !== undefined || fine) {
      return {
        tier:           tierText,
        fineBucket:     fine ?? "unknown",
        tierBucket:     compactTierBucket(fine),
        mmr:            Number.isFinite(Number(mmr)) ? Number(mmr) : undefined,
        rank:           firstValue(row, ["rank", "ranking", "rankNumber"]),
      };
    }
  }
  return { fineBucket: "unknown", tierBucket: "unknown" };
}

// ── User ID lookup ───────────────────────────────────────────────────────────

function userIdOf(value) {
  if (!value || typeof value !== "object") return undefined;
  const direct = firstValue(value, ["userId", "user_id", "uid"]);
  if (direct) return direct;
  if (Array.isArray(value)) {
    for (const item of value) { const f = userIdOf(item); if (f) return f; }
    return undefined;
  }
  for (const item of Object.values(value)) { const f = userIdOf(item); if (f) return f; }
  return undefined;
}

export async function lookupUserId(client, nickname) {
  const enc = encodeURIComponent(nickname);
  for (const endpoint of [
    `/v1/user/nickname?query=${enc}`,
    `/v1/user/nickname/${enc}`,
    `/v1/user?nickname=${enc}`,
  ]) {
    try {
      const payload = await client.getJson(endpoint, { cache: false });
      const id = userIdOf(payload);
      if (id) return id;
    } catch { /* try next */ }
  }
  return undefined;
}

export async function lookupRankInfo(client, userId, season, teamMode) {
  try {
    const payload = await client.getJson(
      `/v1/rank/uid/${encodeURIComponent(userId)}/${season}/${teamMode}`,
      { cache: false }
    );
    return extractRankInfo(payload);
  } catch {
    return { fineBucket: "unknown", tierBucket: "unknown" };
  }
}

// ── Game normalisation ───────────────────────────────────────────────────────

function traitInfoOf(row) {
  const t = {};
  for (const [k, ks] of Object.entries({
    core:               ["traitFirstCore", "traitCore"],
    firstSub:           ["traitFirstSub", "traitSub1"],
    secondSub:          ["traitSecondSub", "traitSub2"],
    tacticalSkill:      ["tacticalSkillGroup", "tacticalSkill"],
    tacticalSkillLevel: ["tacticalSkillLevel"],
  })) {
    const v = firstValue(row, ks);
    if (v !== undefined) t[k] = v;
  }
  return t;
}

function compactStats(row) {
  return {
    kills:            Number(firstValue(row, ["playerKill", "kills"]) ?? 0),
    assists:          Number(firstValue(row, ["playerAssistant", "assists"]) ?? 0),
    teamKills:        Number(firstValue(row, ["teamKill"]) ?? 0),
    damageToPlayer:   Number(firstValue(row, ["damageToPlayer", "totalDamageToPlayer"]) ?? 0),
    damageToPlayerBasic: Number(firstValue(row, ["damageToPlayer_basic"]) ?? 0),
    damageToPlayerSkill: Number(firstValue(row, ["damageToPlayer_skill"]) ?? 0),
    damageToPlayerItemSkill: Number(firstValue(row, ["damageToPlayer_itemSkill"]) ?? 0),
    damageToPlayerDirect: Number(firstValue(row, ["damageToPlayer_direct"]) ?? 0),
    damageToPlayerUniqueSkill: Number(firstValue(row, ["damageToPlayer_uniqueSkill"]) ?? 0),
    damageFromPlayer: Number(firstValue(row, ["damageFromPlayer", "totalDamageFromPlayer"]) ?? 0),
    damageFromPlayerBasic: Number(firstValue(row, ["damageFromPlayer_basic"]) ?? 0),
    damageFromPlayerSkill: Number(firstValue(row, ["damageFromPlayer_skill"]) ?? 0),
    ccCount:          Number(firstValue(row, ["ccCount", "crowdControlCount"]) ?? 0),
    ccTime:           Number(firstValue(row, ["ccTimeToPlayer", "ccTime"]) ?? 0),
    healAmount:       Number(firstValue(row, ["healAmount"]) ?? 0),
    protectAbsorb:    Number(firstValue(row, ["protectAbsorb"]) ?? 0),
    visionScore:      Number(firstValue(row, ["sightScore", "visionScore"]) ?? 0),
  };
}

export function normalizeGame(gameId, payload, sourceRankInfo) {
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
        rank:              firstValue(row, ["gameRank", "game_rank"]),
        victory:           Boolean(firstValue(row, ["victory"])),
        tierBucket:        sourceRankInfo?.tierBucket ?? "unknown",
        fineBucket:        sourceRankInfo?.fineBucket,
        sourceRankMmr:     sourceRankInfo?.mmr,
        matchingMode:      firstValue(row, ["matchingMode", "matching_mode"]),
        matchingTeamMode:  firstValue(row, ["matchingTeamMode", "matching_team_mode"]),
        seasonId:          firstValue(row, ["seasonId", "season_id"]),
        players: [],
      });
    }
    teamMap.get(key).players.push({
      character: characterOf(row),
      weapon:    weaponOf(row),
      traits:    traitInfoOf(row),
      stats:     compactStats(row),
      gameRank:  firstValue(row, ["gameRank", "game_rank"]),
    });
  }
  return [...teamMap.values()].filter((t) => t.players.length >= 2);
}

/** Extract other players' user identifiers from a game payload (for depth-1 expansion). */
export function extractPlayerIds(gamePayload) {
  const rows = gameRows(gamePayload);
  const ids = [];
  for (const row of rows) {
    const userId   = firstValue(row, ["userId", "user_id", "uid"]);
    const nickname = firstValue(row, ["nickname", "nickName"]);
    if (userId)   ids.push({ type: "userId",   value: userId });
    else if (nickname) ids.push({ type: "nickname", value: nickname });
  }
  return ids;
}
