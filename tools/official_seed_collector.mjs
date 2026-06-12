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
  delayMs:         1000,
  retry429Ms:      60000,
  strictTier:      false,
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
      case "--delay-ms":           args.delayMs         = Number(value); break;
      case "--retry-429-ms":       args.retry429Ms      = Number(value); break;
      case "--strict-tier":        args.strictTier      = value !== "false"; break;
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

async function collectGamesForUser(client, userId, options, knownTierBucket, gameIds, gameRankInfo) {
  const rankInfo     = await lookupRankInfo(client, userId, options.season, options.teamMode);
  const actualBucket = rankInfo.tierBucket;

  if (options.strictTier && actualBucket !== knownTierBucket && actualBucket !== "unknown") {
    return { skipped: true, reason: "tier_mismatch", actual: actualBucket };
  }

  const effectiveBucket   = actualBucket !== "unknown" ? actualBucket : knownTierBucket;
  const effectiveRankInfo = { ...rankInfo, tierBucket: effectiveBucket };

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
  gameIds, gameRankInfo, processedUsers, label
) {
  let expanded = 0;
  for (const gameId of sourceGameIds) {
    if (processedUsers.size >= options.maxUsersPerTier) break;

    let gamePayload;
    try {
      gamePayload = await client.getJson(`/v1/games/${gameId}`, { cacheKey: `game:${gameId}` });
    } catch { continue; }

    for (const { type, value } of extractPlayerIds(gamePayload)) {
      if (processedUsers.size >= options.maxUsersPerTier) break;

      let userId;
      try {
        userId = type === "userId" ? value : await lookupUserId(client, value);
      } catch { continue; }

      if (!userId || processedUsers.has(String(userId))) continue;
      processedUsers.add(String(userId));

      try {
        const result = await collectGamesForUser(
          client, userId, options, tierBucket, gameIds, gameRankInfo
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

async function expandTier(client, tierBucket, seeds, options, gameIds, gameRankInfo) {
  const processedUsers = new Set();

  // Phase 0a: userId seeds from previous run
  for (const userId of (seeds.userIds ?? [])) {
    if (processedUsers.size >= options.maxUsersPerTier) break;
    const uid = String(userId);
    if (processedUsers.has(uid)) continue;
    processedUsers.add(uid);
    process.stdout.write(`  [${tierBucket}] userId-seed ...${uid.slice(-6)} `);
    try {
      const r = await collectGamesForUser(client, uid, options, tierBucket, gameIds, gameRankInfo);
      console.log(r.skipped ? `skipped (${r.actual})` : `+${r.added} games (${r.tierBucket}, mmr:${r.mmr ?? "?"})`);
    } catch (err) { console.log(`error: ${err.message}`); }
  }

  // Phase 0b: nickname seeds
  for (const [i, nickname] of (seeds.nicknames ?? []).entries()) {
    if (processedUsers.size >= options.maxUsersPerTier) break;
    process.stdout.write(`  [${tierBucket}] seed ${i + 1}/${seeds.nicknames.length} "${nickname}" ... `);
    const userId = await lookupUserId(client, nickname);
    if (!userId) { console.log("lookup failed"); continue; }
    if (processedUsers.has(String(userId))) { console.log("already seen"); continue; }
    processedUsers.add(String(userId));
    try {
      const r = await collectGamesForUser(client, userId, options, tierBucket, gameIds, gameRankInfo);
      console.log(r.skipped ? `skipped (${r.actual})` : `+${r.added} games (${r.tierBucket}, mmr:${r.mmr ?? "?"}) - total: ${gameIds.size}`);
    } catch (err) { console.log(`error: ${err.message}`); }
  }

  const afterDepth0 = new Set(gameIds);
  console.log(`  [${tierBucket}] depth-0: ${processedUsers.size} users, ${afterDepth0.size} games`);

  // Phase 1: depth-1 expansion
  if (options.depth >= 1) {
    await expandFromGames(
      client, [...afterDepth0], tierBucket, options,
      gameIds, gameRankInfo, processedUsers, "depth-1"
    );
  }

  // Phase 2: depth-2 expansion
  if (options.depth >= 2) {
    const newDepth1Games = [...gameIds].filter(id => !afterDepth0.has(id));
    if (newDepth1Games.length > 0) {
      console.log(`  [${tierBucket}] depth-2: expanding from ${newDepth1Games.length} new games...`);
      await expandFromGames(
        client, newDepth1Games, tierBucket, options,
        gameIds, gameRankInfo, processedUsers, "depth-2"
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

  const allTierBuckets = [...new Set([...Object.keys(nicknameTiers), ...Object.keys(userIdTiers)])];
  if (allTierBuckets.length === 0) {
    console.error("No tiers found."); process.exit(1);
  }

  console.log(`\nSeason: ${options.season}  teamMode: ${options.teamMode}  depth: ${options.depth}  maxUsers/tier: ${options.maxUsersPerTier}`);
  console.log(`Tiers: ${allTierBuckets.join(", ")}\n`);

  const gameIds      = new Set();
  const gameRankInfo = new Map();
  const tierUserIds  = {};

  for (const tierBucket of allTierBuckets) {
    const compacted = compactTierBucket(tierBucket) || tierBucket;
    const seeds = {
      userIds:   (userIdTiers[tierBucket]?.userIds ?? []).map(String),
      nicknames: nicknameTiers[tierBucket] ?? [],
    };
    console.log(`\n[${tierBucket}] ${seeds.userIds.length} userId-seeds + ${seeds.nicknames.length} nickname-seeds`);

    const { processedUserIds } = await expandTier(
      client, compacted, seeds, options, gameIds, gameRankInfo
    );
    tierUserIds[compacted] = processedUserIds;
  }

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
  for (const [tier, userIds] of Object.entries(tierUserIds)) {
    const sampled = shuffleSample(userIds, options.nextSeedCount);
    nextSeeds.tiers[tier] = { userIds: sampled };
    console.log(`  [${tier}] next-seeds: ${sampled.length}/${userIds.length} userIds sampled`);
  }
  await fs.writeFile(options.nextSeeds, JSON.stringify(nextSeeds, null, 2), "utf8");
  console.log(`Saved next-seeds: ${path.relative(ROOT, options.nextSeeds)}`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
