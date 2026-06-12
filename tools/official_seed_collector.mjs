/**
 * official_seed_collector.mjs
 *
 * Tier-seeded match collector for the Eternal Return Official API.
 * Reads per-tier nickname seeds from a JSON file and collects game
 * compositions for each tier independently.
 *
 * Usage:
 *   npm run collect-official-seeds
 *   npm run collect-official-seeds -- --seeds data/official-tier-seeds.json \
 *       --games-per-user 8 --depth 1 --delay-ms 2500 --retry-429-ms 30000
 *
 * Privacy:
 *   - Nicknames and userIds are NEVER written to the output file.
 *   - Game-detail cache is keyed by gameId only (safe).
 *   - Nickname / userId lookups are never cached.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireEnv } from "./env.mjs";
import {
  makeClient,
  sleep,
  gameRows,
  gameIdOf,
  rankRows,
  nicknameOf,
  lookupUserId,
  lookupRankInfo,
  compactTierBucket,
  normalizeGame,
  extractPlayerIds,
} from "./official_collect_utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, "..");
const BASE_URL   = process.env.ER_API_BASE_URL?.trim() || "https://open-api.bser.io";

const DEFAULTS = {
  seeds:          path.join(ROOT, "data", "official-tier-seeds.json"),
  out:            path.join(ROOT, "data", "official-match-input-seeded.json"),
  season:         undefined,   // read from seeds file if not provided
  teamMode:       undefined,
  matchingMode:   undefined,
  gamesPerUser:   8,
  depth:          1,
  maxUsersPerTier: 60,
  delayMs:        2500,
  retry429Ms:     30000,
  strictTier:     false,
};

function parseArgs() {
  const args = { ...DEFAULTS };
  for (let i = 2; i < process.argv.length; i += 1) {
    const key   = process.argv[i];
    const value = process.argv[i + 1];
    if (!key.startsWith("--")) continue;
    i += 1;
    switch (key) {
      case "--seeds":            args.seeds           = path.resolve(ROOT, value); break;
      case "--out":              args.out             = path.resolve(ROOT, value); break;
      case "--season":           args.season          = Number(value); break;
      case "--team-mode":        args.teamMode        = Number(value); break;
      case "--matching-mode":    args.matchingMode    = Number(value); break;
      case "--games-per-user":   args.gamesPerUser    = Number(value); break;
      case "--depth":            args.depth           = Number(value); break;
      case "--max-users-per-tier": args.maxUsersPerTier = Number(value); break;
      case "--delay-ms":         args.delayMs         = Number(value); break;
      case "--retry-429-ms":     args.retry429Ms      = Number(value); break;
      case "--strict-tier":      args.strictTier      = value !== "false"; break;
    }
  }
  return args;
}

// ── Per-user game collection ─────────────────────────────────────────────────

async function collectGamesForUser(client, userId, options, knownTierBucket, gameIds, gameRankInfo) {
  const rankInfo = await lookupRankInfo(client, userId, options.season, options.teamMode);
  const actualBucket = rankInfo.tierBucket;

  if (options.strictTier && actualBucket !== knownTierBucket && actualBucket !== "unknown") {
    return { skipped: true, reason: "tier_mismatch", actual: actualBucket };
  }

  const effectiveBucket = actualBucket !== "unknown" ? actualBucket : knownTierBucket;
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

// ── Seed user expansion ──────────────────────────────────────────────────────

async function expandTier(client, tierBucket, nicknames, options, gameIds, gameRankInfo) {
  const maxUsers = options.maxUsersPerTier;
  const processedUsers = new Set();
  let userCount = 0;

  // Phase 1: seed nicknames
  for (const [i, nickname] of nicknames.entries()) {
    if (userCount >= maxUsers) break;
    process.stdout.write(`  [${tierBucket}] seed ${i + 1}/${nicknames.length} "${nickname}" ... `);

    const userId = await lookupUserId(client, nickname);
    if (!userId) { console.log("lookup failed, skipping"); continue; }
    if (processedUsers.has(userId)) { console.log("already seen"); continue; }
    processedUsers.add(userId);

    try {
      const result = await collectGamesForUser(client, userId, options, tierBucket, gameIds, gameRankInfo);
      if (result.skipped) {
        console.log(`skipped (actual tier: ${result.actual})`);
      } else {
        userCount++;
        console.log(`+${result.added} new gameIds (tier: ${result.tierBucket}, mmr: ${result.mmr ?? "?"}) — total unique: ${gameIds.size}`);
      }
    } catch (err) {
      console.log(`error: ${err.message}`);
    }
  }

  // Phase 2: depth-1 expansion via game participants
  if (options.depth >= 1) {
    const seedGameIds = [...gameIds]; // snapshot before expansion
    let expanded = 0;

    for (const gameId of seedGameIds) {
      if (userCount >= maxUsers) break;
      let gamePayload;
      try {
        gamePayload = await client.getJson(`/v1/games/${gameId}`, { cacheKey: `game:${gameId}` });
      } catch { continue; }

      const playerIds = extractPlayerIds(gamePayload);
      for (const { type, value } of playerIds) {
        if (userCount >= maxUsers) break;

        let userId;
        try {
          if (type === "userId") {
            userId = value;
          } else {
            userId = await lookupUserId(client, value);
          }
        } catch { continue; }

        if (!userId || processedUsers.has(userId)) continue;
        processedUsers.add(userId);

        try {
          const result = await collectGamesForUser(client, userId, options, tierBucket, gameIds, gameRankInfo);
          if (!result.skipped) {
            userCount++;
            expanded++;
            if (expanded % 5 === 0) {
              console.log(`  [${tierBucket}] depth-1: ${expanded} users expanded, unique games: ${gameIds.size}`);
            }
          }
        } catch { /* skip */ }
      }
    }
    if (expanded > 0) console.log(`  [${tierBucket}] depth-1 expansion: ${expanded} additional users, ${gameIds.size} unique games`);
  }
}

// ── Fetch + normalise all collected games ────────────────────────────────────

async function fetchAndNormalize(client, gameIds, gameRankInfo) {
  const teams = [];
  const dedupKeys = new Set();
  const allIds = [...gameIds];

  for (const [i, gameId] of allIds.entries()) {
    let payload;
    try {
      payload = await client.getJson(`/v1/games/${gameId}`, { cacheKey: `game:${gameId}` });
    } catch (err) {
      console.log(`  game ${i + 1}/${allIds.length} ${gameId}: fetch error — ${err.message}`);
      continue;
    }

    const rankInfo = gameRankInfo.get(String(gameId));
    for (const team of normalizeGame(gameId, payload, rankInfo)) {
      const key = `${team.gameId}:${team.teamKey}`;
      if (dedupKeys.has(key)) continue;
      dedupKeys.add(key);
      teams.push(team);
    }

    if ((i + 1) % 20 === 0 || i + 1 === allIds.length) {
      console.log(`  game ${i + 1}/${allIds.length}: ${teams.length} teams`);
    }
  }
  return teams;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const options = parseArgs();
  const apiKey  = requireEnv("ER_API_KEY");
  const client  = makeClient(apiKey, BASE_URL, options.delayMs, options.retry429Ms);

  // Load seeds file
  let seedsConfig;
  try {
    seedsConfig = JSON.parse(await fs.readFile(options.seeds, "utf8"));
  } catch {
    console.error(`Seeds file not found: ${options.seeds}`);
    console.error(`Copy data/official-tier-seeds.example.json to ${path.basename(options.seeds)} and fill in nicknames.`);
    process.exit(1);
  }

  // Merge season/teamMode from seeds file if not overridden via CLI
  if (!options.season)      options.season      = seedsConfig.season      ?? 39;
  if (!options.teamMode)    options.teamMode    = seedsConfig.teamMode    ?? 3;
  if (!options.matchingMode) options.matchingMode = seedsConfig.matchingMode ?? 3;

  const tiers = seedsConfig.tiers ?? {};
  const seedBuckets = Object.keys(tiers);
  if (seedBuckets.length === 0) {
    console.error("No tiers found in seeds file."); process.exit(1);
  }

  console.log(`Season: ${options.season}  teamMode: ${options.teamMode}  depth: ${options.depth}`);
  console.log(`Tiers: ${seedBuckets.join(", ")}\n`);

  const gameIds     = new Set();
  const gameRankInfo = new Map();

  // Expand each tier
  for (const [tierBucket, nicknames] of Object.entries(tiers)) {
    const compacted = compactTierBucket(tierBucket) || tierBucket;
    console.log(`\n═══ ${tierBucket} (${nicknames.length} seeds, max ${options.maxUsersPerTier} users, depth ${options.depth}) ═══`);
    await expandTier(client, compacted, nicknames, options, gameIds, gameRankInfo);
  }

  // Fetch and normalize
  console.log(`\n═══ Fetching ${gameIds.size} unique games ═══`);
  const teams = await fetchAndNormalize(client, gameIds, gameRankInfo);

  // Summary
  const byTier = {};
  for (const t of teams) byTier[t.tierBucket] = (byTier[t.tierBucket] ?? 0) + 1;
  console.log("\n[summary] teams by tier:", byTier);

  const output = {
    generatedAt:  new Date().toISOString(),
    source:       "official-api-seeded",
    seedBuckets,
    collection: {
      season:           options.season,
      teamMode:         options.teamMode,
      depth:            options.depth,
      gamesPerUser:     options.gamesPerUser,
      maxUsersPerTier:  options.maxUsersPerTier,
      strictTier:       options.strictTier,
      storesNicknames:  false,
      storesUserIds:    false,
    },
    tierBreakdown: byTier,
    teams,
  };

  await fs.mkdir(path.dirname(options.out), { recursive: true });
  await fs.writeFile(options.out, JSON.stringify(output, null, 2), "utf8");
  console.log(`\nSaved: ${path.relative(ROOT, options.out)} (${teams.length} teams)`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
