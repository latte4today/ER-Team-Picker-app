/**
 * official_seed_collector.mjs
 *
 * Tier-seeded match collector for the Eternal Return Official API.
 *
 * Seed sources (in priority order):
 *   1. data/official-next-seeds.json  - userIds sampled from previous run (auto-rotated)
 *   2. data/official-tier-seeds.json  - initial nicknames provided by user
 *
 * Depth behaviour:
 *   depth 0 - seeds only
 *   depth 1 - seeds + participants from seed games
 *   depth 2 - depth 1 + participants from depth-1 games
 *
 * After collection, N random userIds per tier are written to
 * data/official-next-seeds.json for the next run (no nicknames stored).
 *
 * Privacy:
 *   - Nicknames and userIds are NEVER written to the match-output file.
 *   - official-next-seeds.json stores only internal userIds (not public nicknames).
 *   - Game-detail cache is keyed by gameId only (safe).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireEnv } from "./env.mjs";
import {
  makeClient,
  gameRows,
  gameIdOf,
  lookupUserId,
  lookupRankInfo,
  compactTierBucket,
  normalizeGame,
  extractPlayerIds,
  rankRows,
  nicknameOf,
  firstValue,
} from "./official_collect_utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT     = path.resolve(__dirname, "..");
const BASE_URL = process.env.ER_API_BASE_URL?.trim() || "https://open-api.bser.io";

const DEFAULTS = {
  seeds:           path.join(ROOT, "data", "official-tier-seeds.json"),
  nextSeeds:       path.join(ROOT, "data", "official-next-seeds.json"),
  out:             path.join(ROOT, "data", "official-match-input-seeded.json"),
  season:          undefined,
  teamMode:        undefined,
  matchingMode:    undefined,
  gamesPerUser:    10,
  depth:           2,
  maxUsersPerTier: 200,
  nextSeedCount:   15,
  seedPoolSize:    50,
  topRankers:      0,                 // >0 = also seed the top tier from the rank leaderboard
  topTier:         "demigod_eternity",
  delayMs:         1000,
  retry429Ms:      60000,
  strictTier:      false,
  targetTeams:     0,        // 0 = no limit; otherwise split evenly across tiers
};

function parseArgs() {
  const args = { ...DEFAULTS };
  for (let i = 2; i < process.argv.length; i += 1) {
    const key   = process.argv[i];
    const value = process.argv[i + 1];
    if (!key.startsWith("--")) continue;
    i += 1;
    switch (key) {
      case "--seeds":              args.seeds           = path.resolve(ROOT, value); break;
      case "--next-seeds":         args.nextSeeds       = path.resolve(ROOT, value); break;
      case "--out":                args.out             = path.resolve(ROOT, value); break;
      case "--season":             args.season          = Number(value); break;
      case "--team-mode":          args.teamMode        = Number(value); break;
      case "--matching-mode":      args.matchingMode    = Number(value); break;
      case "--games-per-user":     args.gamesPerUser    = Number(value); break;
      case "--depth":              args.depth           = Number(value); break;
      case "--max-users-per-tier": args.maxUsersPerTier = Number(value); break;
      case "--next-seed-count":    args.nextSeedCount   = Number(value); break;
      case "--seed-pool-size":     args.seedPoolSize    = Number(value); break;
      case "--top-rankers":        args.topRankers      = Number(value); break;
      case "--top-tier":           args.topTier         = value; break;
      case "--delay-ms":           args.delayMs         = Number(value); break;
      case "--retry-429-ms":       args.retry429Ms      = Number(value); break;
      case "--strict-tier":        args.strictTier      = value !== "false"; break;
      case "--target-teams":       args.targetTeams     = Number(value); break;
    }
  }
  return args;
}

function shuffleSample(arr, n) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

function estimatedTeamsFromGames(gameIds) {
  return gameIds.size * 3;
}

function reachedTierTarget(gameIds, options) {
  return options.targetTeamsPerTier > 0 &&
    estimatedTeamsFromGames(gameIds) >= options.targetTeamsPerTier;
}

async function collectGamesForUser(client, userId, options, knownTierBucket, gameIds, gameRankInfo, userTier) {
  const rankInfo     = await lookupRankInfo(client, userId, options.season, options.teamMode);
  const actualBucket = rankInfo.tierBucket;

  if (options.strictTier && actualBucket !== knownTierBucket && actualBucket !== "unknown") {
    return { skipped: true, reason: "tier_mismatch", actual: actualBucket };
  }

  const effectiveBucket   = actualBucket !== "unknown" ? actualBucket : knownTierBucket;
  const effectiveRankInfo = { ...rankInfo, tierBucket: effectiveBucket };
  // Record this user's MEASURED tier so seed rotation files them by real tier (not the
  // expansion bucket), preventing cross-tier seed drift. Unmeasured users are left out.
  if (userTier && actualBucket !== "unknown") userTier.set(String(userId), effectiveBucket);

  const gamesPayload = await client.getJson(
    `/v1/user/games/uid/${encodeURIComponent(userId)}`,
    { cache: false }
  );
  const ids = gameRows(gamesPayload).map(gameIdOf).filter(Boolean).slice(0, options.gamesPerUser);
  let added = 0;
  for (const id of ids) {
    gameIds.add(id);
    if (!gameRankInfo.has(String(id))) {
      gameRankInfo.set(String(id), effectiveRankInfo);
      added++;
    }
  }
  return { added, total: ids.length, tierBucket: effectiveBucket, mmr: rankInfo.mmr };
}

async function expandFromGames(
  client, sourceGameIds, tierBucket, options,
  gameIds, gameRankInfo, processedUsers, label, userTier
) {
  let expanded = 0;
  for (const gameId of sourceGameIds) {
    if (processedUsers.size >= options.maxUsersPerTier) break;
    if (reachedTierTarget(gameIds, options)) break;

    let gamePayload;
    try {
      gamePayload = await client.getJson(`/v1/games/${gameId}`, { cacheKey: `game:${gameId}` });
    } catch { continue; }

    for (const { type, value } of extractPlayerIds(gamePayload)) {
      if (processedUsers.size >= options.maxUsersPerTier) break;
      if (reachedTierTarget(gameIds, options)) break;

      let userId;
      try {
        userId = type === "userId" ? value : await lookupUserId(client, value);
      } catch { continue; }

      if (!userId || processedUsers.has(String(userId))) continue;
      processedUsers.add(String(userId));

      try {
        const result = await collectGamesForUser(
          client, userId, options, tierBucket, gameIds, gameRankInfo, userTier
        );
        if (!result.skipped) {
          expanded++;
          if (expanded % 10 === 0) {
            process.stdout.write(`  [${tierBucket}] ${label}: ${expanded} users, ${gameIds.size} games\r`);
          }
        }
      } catch { /* skip */ }
    }
  }
  if (expanded > 0) {
    console.log(`  [${tierBucket}] ${label}: done - ${expanded} users, ${gameIds.size} total games`);
  }
  return expanded;
}

async function expandTier(client, tierBucket, seeds, options, gameIds, gameRankInfo, userTier) {
  const processedUsers = new Set();

  // Phase 0a: userId seeds from previous run
  for (const userId of (seeds.userIds ?? [])) {
    if (processedUsers.size >= options.maxUsersPerTier) break;
    if (reachedTierTarget(gameIds, options)) break;
    const uid = String(userId);
    if (processedUsers.has(uid)) continue;
    processedUsers.add(uid);
    process.stdout.write(`  [${tierBucket}] userId-seed ...${uid.slice(-6)} `);
    try {
      const r = await collectGamesForUser(client, uid, options, tierBucket, gameIds, gameRankInfo, userTier);
      console.log(r.skipped ? `skipped (${r.actual})` : `+${r.added} games (${r.tierBucket}, mmr:${r.mmr ?? "?"})`);
    } catch (err) { console.log(`error: ${err.message}`); }
  }

  // Phase 0b: nickname seeds
  for (const [i, nickname] of (seeds.nicknames ?? []).entries()) {
    if (processedUsers.size >= options.maxUsersPerTier) break;
    if (reachedTierTarget(gameIds, options)) break;
    process.stdout.write(`  [${tierBucket}] seed ${i + 1}/${seeds.nicknames.length} "${nickname}" ... `);
    const userId = await lookupUserId(client, nickname);
    if (!userId) { console.log("lookup failed"); continue; }
    if (processedUsers.has(String(userId))) { console.log("already seen"); continue; }
    processedUsers.add(String(userId));
    try {
      const r = await collectGamesForUser(client, userId, options, tierBucket, gameIds, gameRankInfo, userTier);
      console.log(r.skipped ? `skipped (${r.actual})` : `+${r.added} games (${r.tierBucket}, mmr:${r.mmr ?? "?"}) - total: ${gameIds.size}`);
    } catch (err) { console.log(`error: ${err.message}`); }
  }

  const afterDepth0 = new Set(gameIds);
  console.log(`  [${tierBucket}] depth-0: ${processedUsers.size} users, ${afterDepth0.size} games`);
  if (reachedTierTarget(gameIds, options)) {
    console.log(`  [${tierBucket}] target reached at depth-0: ~${estimatedTeamsFromGames(gameIds)} teams`);
  }

  // Phase 1: depth-1 expansion
  if (options.depth >= 1 && !reachedTierTarget(gameIds, options)) {
    await expandFromGames(
      client, [...afterDepth0], tierBucket, options,
      gameIds, gameRankInfo, processedUsers, "depth-1", userTier
    );
  }

  // Phase 2: depth-2 expansion
  if (options.depth >= 2 && !reachedTierTarget(gameIds, options)) {
    const newDepth1Games = [...gameIds].filter(id => !afterDepth0.has(id));
    if (newDepth1Games.length > 0) {
      console.log(`  [${tierBucket}] depth-2: expanding from ${newDepth1Games.length} new games...`);
      await expandFromGames(
        client, newDepth1Games, tierBucket, options,
        gameIds, gameRankInfo, processedUsers, "depth-2", userTier
      );
    }
  }

  console.log(`  [${tierBucket}] complete: ${processedUsers.size} users, ${gameIds.size} total games`);
  return { processedUserIds: [...processedUsers] };
}

async function fetchAndNormalize(client, gameIds, gameRankInfo) {
  const teams     = [];
  const dedupKeys = new Set();
  const allIds    = [...gameIds];

  for (const [i, gameId] of allIds.entries()) {
    let payload;
    try {
      payload = await client.getJson(`/v1/games/${gameId}`, { cacheKey: `game:${gameId}` });
    } catch (err) {
      console.log(`  game ${i + 1}/${allIds.length} ${gameId}: fetch error - ${err.message}`);
      continue;
    }

    const rankInfo = gameRankInfo.get(String(gameId));
    for (const team of normalizeGame(gameId, payload, rankInfo)) {
      const key = `${team.gameId}:${team.teamKey}`;
      if (dedupKeys.has(key)) continue;
      dedupKeys.add(key);
      teams.push(team);
    }

    if ((i + 1) % 50 === 0 || i + 1 === allIds.length) {
      console.log(`  game ${i + 1}/${allIds.length}: ${teams.length} teams so far`);
    }
  }
  return teams;
}

function rankUserIdOf(row) {
  return firstValue(row, ["userNum", "userId", "user_id", "uid"]);
}

/** Fetch top-ranked userIds from the leaderboard (authoritative source for the top tier). */
async function fetchTopRankerUserIds(client, season, teamMode, limit) {
  const ids = [];
  try {
    const payload = await client.getJson(`/v1/rank/top/${season}/${teamMode}`, { cache: false });
    for (const row of rankRows(payload).slice(0, limit)) {
      let uid = rankUserIdOf(row);
      if (!uid) {
        const nick = nicknameOf(row);
        if (nick) { try { uid = await lookupUserId(client, nick); } catch { /* skip */ } }
      }
      if (uid) ids.push(String(uid));
    }
  } catch (err) {
    console.log(`[top-rankers] leaderboard fetch failed: ${err.message}`);
  }
  return [...new Set(ids)];
}

async function main() {
  const options = parseArgs();
  const apiKey  = requireEnv("ER_API_KEY");
  const client  = makeClient(apiKey, BASE_URL, options.delayMs, options.retry429Ms);

  // Load nickname seeds
  let seedsConfig;
  try {
    seedsConfig = JSON.parse(await fs.readFile(options.seeds, "utf8"));
  } catch {
    console.error(`Seeds file not found: ${options.seeds}`);
    process.exit(1);
  }

  if (!options.season)       options.season       = seedsConfig.season       ?? 39;
  if (!options.teamMode)     options.teamMode     = seedsConfig.teamMode     ?? 3;
  if (!options.matchingMode) options.matchingMode = seedsConfig.matchingMode ?? 3;

  const nicknameTiers = seedsConfig.tiers ?? {};

  // Load next-seeds (userId rotation from previous run)
  let nextSeedsConfig = {};
  try {
    nextSeedsConfig = JSON.parse(await fs.readFile(options.nextSeeds, "utf8"));
    console.log(`Loaded next-seeds from: ${path.relative(ROOT, options.nextSeeds)}`);
  } catch {
    console.log(`No next-seeds file - starting fresh from nickname seeds.`);
  }
  const userIdTiers = nextSeedsConfig.tiers ?? {};

  // Seed the sparse top tier directly from the rank leaderboard each run. The leaderboard is
  // the authoritative source of top players; injected userIds self-sort to their real tier via
  // the measured-tier rotation, so this feeds demigod_eternity (and the top of meteor_mithril).
  if (options.topRankers > 0) {
    const topIds = await fetchTopRankerUserIds(client, options.season, options.teamMode, options.topRankers);
    if (topIds.length) {
      const bucket = options.topTier;
      const existing = (userIdTiers[bucket]?.userIds ?? []).map(String);
      userIdTiers[bucket] = { userIds: [...new Set([...topIds, ...existing])] };
      console.log(`[top-rankers] injected ${topIds.length} leaderboard userIds into ${bucket}`);
    }
  }

  const allTierBuckets = [...new Set([...Object.keys(nicknameTiers), ...Object.keys(userIdTiers)])];
  if (allTierBuckets.length === 0) {
    console.error("No tiers found."); process.exit(1);
  }

  const targetTeamsPerTier = options.targetTeams > 0
    ? Math.ceil(options.targetTeams / allTierBuckets.length)
    : 0;
  const targetLabel = options.targetTeams > 0
    ? `  targetTeams: ${options.targetTeams} (~${targetTeamsPerTier}/tier)`
    : '';
  console.log(`\nSeason: ${options.season}  teamMode: ${options.teamMode}  depth: ${options.depth}  maxUsers/tier: ${options.maxUsersPerTier}${targetLabel}`);
  console.log(`Tiers: ${allTierBuckets.join(", ")}\n`);

  // Each tier expands independently to avoid cross-tier gameId saturation
  const allGameIds      = new Set();
  const allGameRankInfo = new Map();
  const tierUserIds     = {};
  const userActualTier  = new Map();  // userId -> measured compact tier (drift-free seed rotation)
  let totalApproxTeams  = 0;

  for (const tierBucket of allTierBuckets) {
    const compacted = compactTierBucket(tierBucket) || tierBucket;
    // Sample nextSeedCount seeds from the stored pool so each run expands from a
    // different subset (prevents seeds being identical run-to-run).
    const rotatingUserIds = shuffleSample((userIdTiers[tierBucket]?.userIds ?? []).map(String), options.nextSeedCount);
    const fallbackNicknames = rotatingUserIds.length > 0 ? [] : (nicknameTiers[tierBucket] ?? []);
    const seeds = {
      userIds:   rotatingUserIds,
      nicknames: fallbackNicknames,
    };
    console.log(`\n[${tierBucket}] ${seeds.userIds.length} userId-seeds + ${seeds.nicknames.length} nickname-seeds${rotatingUserIds.length > 0 ? " (nickname fallback disabled)" : ""}`);
    const tierOptions = { ...options, targetTeamsPerTier };

    // Use tier-local sets so expansion isn't blocked by other tiers' games
    const tierGameIds      = new Set();
    const tierGameRankInfo = new Map();
    const { processedUserIds } = await expandTier(
      client, compacted, seeds, tierOptions, tierGameIds, tierGameRankInfo, userActualTier
    );
    tierUserIds[compacted] = processedUserIds;

    // Merge tier results into global sets
    for (const id of tierGameIds)                   allGameIds.add(id);
    for (const [k, v] of tierGameRankInfo.entries()) allGameRankInfo.set(k, v);
    totalApproxTeams += tierGameIds.size * 3;
    console.log(`  [${tierBucket}] contributed ${tierGameIds.size} games (~${tierGameIds.size * 3} teams); running total ~${totalApproxTeams}`);
  }
  const gameIds      = allGameIds;
  const gameRankInfo = allGameRankInfo;

  console.log(`\n[normalise] ${gameIds.size} unique games`);
  const teams = await fetchAndNormalize(client, gameIds, gameRankInfo);

  const byTier = {};
  for (const t of teams) byTier[t.tierBucket] = (byTier[t.tierBucket] ?? 0) + 1;
  console.log("[summary] teams by tier:", byTier);

  // Write match output
  await fs.mkdir(path.dirname(options.out), { recursive: true });
  await fs.writeFile(options.out, JSON.stringify({
    generatedAt: new Date().toISOString(),
    source:      "official-api-seeded",
    collection: {
      season:          options.season,
      teamMode:        options.teamMode,
      depth:           options.depth,
      gamesPerUser:    options.gamesPerUser,
      maxUsersPerTier: options.maxUsersPerTier,
      targetTeams:     options.targetTeams,
      targetTeamsPerTier,
      strictTier:      options.strictTier,
      storesNicknames: false,
      storesUserIds:   false,
    },
    tierBreakdown: byTier,
    teams,
  }, null, 2), "utf8");
  console.log(`\nSaved: ${path.relative(ROOT, options.out)} (${teams.length} teams)`);

  // Seed rotation
  const nextSeeds = {
    _note:       "Auto-generated. Contains internal userIds only (no nicknames).",
    generatedAt: new Date().toISOString(),
    season:      options.season,
    teamMode:    options.teamMode,
    tiers:       {},
  };
  // Rolling seed accumulation by ACTUAL measured tier. Keep up to seedPoolSize userIds
  // per tier (merging this run's finds with the previous pool) so sparse low tiers don't
  // dry up. Each run samples nextSeedCount from this pool to actually expand from.
  const measuredThisRun = new Map();   // tier -> [userIds measured this run]
  const userMovedTier   = new Map();   // userId -> tier measured this run (self-cleaning)
  for (const [uid, tier] of userActualTier.entries()) {
    if (!tier || tier === "unknown") continue;
    if (!measuredThisRun.has(tier)) measuredThisRun.set(tier, []);
    measuredThisRun.get(tier).push(String(uid));
    userMovedTier.set(String(uid), tier);
  }
  const priorTiers   = nextSeedsConfig.tiers ?? {};
  const rotationTiers = new Set([...Object.keys(priorTiers), ...measuredThisRun.keys()]);
  for (const tier of rotationTiers) {
    const fresh = measuredThisRun.get(tier) ?? [];
    const prior = (priorTiers[tier]?.userIds ?? [])
      .map(String)
      .filter((uid) => (userMovedTier.get(uid) ?? tier) === tier); // drop users who moved tier
    const pool = [...new Set([...fresh, ...prior])].slice(0, options.seedPoolSize);
    if (pool.length === 0) continue;
    nextSeeds.tiers[tier] = { userIds: pool };
    const carried = pool.length - pool.filter((uid) => fresh.includes(uid)).length;
    console.log(`  [${tier}] seed pool: ${pool.length}/${options.seedPoolSize} (fresh ${fresh.length}, carried ${carried})`);
  }
  await fs.writeFile(options.nextSeeds, JSON.stringify(nextSeeds, null, 2), "utf8");
  console.log(`Saved next-seeds: ${path.relative(ROOT, options.nextSeeds)}`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
