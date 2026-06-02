import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CACHE_DIR = path.join(ROOT, "data", "dak-cache");
const META_PATH = path.join(ROOT, "src", "metaData.js");
const DATA_PATH = path.join(ROOT, "src", "data.js");
const API_BASE = "https://er.dakgg.io";

const DEFAULTS = {
  rankers: 200,
  matchesPerRanker: 12,
  delayMs: 650,
  seasonKey: undefined,
  serverName: "seoul",
  teamMode: "SQUAD",
  matchingMode: "RANK",
  locale: "ko",
  output: META_PATH,
};

const tierBuckets = [
  ["platinum_plus", "platinum_plus"],
  ["diamond_plus", "diamond_plus"],
  ["mithril_plus", "mithril_plus"],
];

function parseArgs() {
  const args = { ...DEFAULTS };
  for (let index = 2; index < process.argv.length; index += 1) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (!key.startsWith("--")) continue;
    index += 1;
    const option = key.slice(2);
    if (["rankers", "matchesPerRanker", "delayMs"].includes(option)) args[option] = Number(value);
    else if (option === "output") args.output = path.resolve(ROOT, value);
    else args[option] = value;
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeName(name) {
  return String(name ?? "").replace(/\s+/g, "").toLowerCase();
}

function cacheName(url) {
  return Buffer.from(url).toString("base64url") + ".json";
}

async function fetchJson(url, { delayMs, force = false } = {}) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, cacheName(url));
  if (!force) {
    try {
      return JSON.parse(await fs.readFile(cachePath, "utf8"));
    } catch {
      // Cache miss.
    }
  }

  const response = await fetch(url, {
    headers: {
      "Dakgg-Language": "ko",
      "User-Agent": "Mozilla/5.0 ER-Team-Picker/0.1",
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  const payload = await response.json();
  await fs.writeFile(cachePath, JSON.stringify(payload), "utf8");
  if (delayMs > 0) await sleep(delayMs);
  return payload;
}

async function getCurrentSeason(locale, delayMs) {
  const url = `${API_BASE}/api/v0/current-season?hl=${encodeURIComponent(locale)}`;
  const payload = await fetchJson(url, { delayMs });
  return payload.type;
}

function readLocalCharacters(source) {
  const regex = /c\("([^"]+)",\s*"([^"]+)"/g;
  const byName = new Map();
  let match;
  while ((match = regex.exec(source))) {
    byName.set(normalizeName(match[2]), match[1]);
  }
  return byName;
}

function buildDakCharacterMap(characterById, localByName) {
  const byNumber = new Map();
  const byKey = {};
  for (const [id, character] of Object.entries(characterById ?? {})) {
    const localId = localByName.get(normalizeName(character.name));
    if (!localId) continue;
    byNumber.set(Number(id), localId);
    byKey[character.key] = localId;
  }
  return { byNumber, byKey };
}

async function collectLeaderboard(options, seasonKey) {
  const rankers = [];
  let characterById = {};
  let page = 1;

  while (rankers.length < options.rankers) {
    const url = `${API_BASE}/api/v0/leaderboard?page=${page}&seasonKey=${encodeURIComponent(seasonKey)}&serverName=${encodeURIComponent(options.serverName)}&teamMode=${encodeURIComponent(options.teamMode)}&hl=${encodeURIComponent(options.locale)}`;
    const payload = await fetchJson(url, { delayMs: options.delayMs });
    characterById = { ...characterById, ...(payload.characterById ?? {}) };
    const rows = payload.leaderboards ?? [];
    if (rows.length === 0) break;
    rankers.push(...rows);
    page += 1;
  }

  return {
    characterById,
    rankers: rankers.slice(0, options.rankers).map((ranker) => ({
      userNum: ranker.userNum,
      nickname: ranker.nickname,
      rank: ranker.rank,
      playCount: ranker.playCount,
      oneTrickRatio: Math.max(0, ...(ranker.mostCharacters ?? []).map((item) => item.pickRate ?? 0)),
      mostCharacters: ranker.mostCharacters ?? [],
    })),
  };
}

async function collectCharacterTiers(options, dakMap) {
  const tiers = {
    all: {},
    bronze: {},
    gold: {},
    platinum_plus: {},
    diamond_plus: {},
    mithril_plus: {},
  };

  for (const [bucket, tier] of tierBuckets) {
    const url = `${API_BASE}/api/v1/character-stats?dt=7&teamMode=SQUAD&matchingMode=RANK&tier=${tier}`;
    const payload = await fetchJson(url, { delayMs: options.delayMs });
    const stats = payload.characterStatSnapshot?.characterStats ?? [];
    for (const stat of stats) {
      const localId = dakMap.byNumber.get(Number(stat.key));
      if (!localId) continue;
      const weaponStats = stat.weaponStats ?? [];
      const best = weaponStats.sort((a, b) => (b.count ?? 0) - (a.count ?? 0))[0];
      if (best?.tier) tiers[bucket][localId] = best.tier;
    }
  }

  tiers.all = { ...tiers.diamond_plus };
  tiers.bronze = { ...tiers.platinum_plus };
  tiers.gold = { ...tiers.platinum_plus };
  return tiers;
}

async function collectPlayerMatches(options, ranker, seasonKey) {
  const url = `${API_BASE}/api/v1/players/${encodeURIComponent(ranker.nickname)}/matches?season=${encodeURIComponent(seasonKey)}&matchingMode=${encodeURIComponent(options.matchingMode)}&teamMode=${encodeURIComponent(options.teamMode)}&page=1`;
  const payload = await fetchJson(url, { delayMs: options.delayMs });
  return (payload.matches ?? []).slice(0, options.matchesPerRanker);
}

async function collectMatchDetail(options, ranker, match) {
  const url = `${API_BASE}/api/v1/players/${encodeURIComponent(ranker.nickname)}/matches/${match.seasonId}/${match.gameId}`;
  return fetchJson(url, { delayMs: options.delayMs });
}

function aggregateRow(map, key, data) {
  const current = map.get(key) ?? {
    games: 0,
    placementSum: 0,
    wins: 0,
    top3: 0,
    oneTrickWeightedSum: 0,
  };
  current.games += 1;
  current.placementSum += data.placement;
  current.wins += data.placement === 1 ? 1 : 0;
  current.top3 += data.placement <= 3 ? 1 : 0;
  current.oneTrickWeightedSum += data.oneTrickRatio;
  map.set(key, current);
}

function summarizeAggregate(value) {
  return {
    games: value.games,
    avgPlacement: Number((value.placementSum / value.games).toFixed(2)),
    winRate: Number((value.wins / value.games).toFixed(3)),
    top3Rate: Number((value.top3 / value.games).toFixed(3)),
    oneTrickRatio: Number((value.oneTrickWeightedSum / value.games).toFixed(3)),
  };
}

async function collectRankerStats(options, rankers, dakMap, seasonKey) {
  const compositionMap = new Map();
  const candidateMap = new Map();
  const seenPerspectiveGames = new Set();

  for (const [index, ranker] of rankers.entries()) {
    console.log(`[${index + 1}/${rankers.length}] ${ranker.nickname} matches`);
    let matches = [];
    try {
      matches = await collectPlayerMatches(options, ranker, seasonKey);
    } catch (error) {
      console.warn(`  skip match list: ${error.message}`);
      continue;
    }

    for (const match of matches) {
      const perspectiveKey = `${ranker.userNum}:${match.gameId}`;
      if (seenPerspectiveGames.has(perspectiveKey)) continue;
      seenPerspectiveGames.add(perspectiveKey);

      let detail;
      try {
        detail = await collectMatchDetail(options, ranker, match);
      } catch (error) {
        console.warn(`  skip detail ${match.gameId}: ${error.message}`);
        continue;
      }

      const rows = detail.matches ?? [];
      const self =
        rows.find((row) => row.nickname === ranker.nickname) ??
        rows.find((row) => row.userNum === ranker.userNum) ??
        match;
      const candidate = dakMap.byNumber.get(Number(self.characterNum));
      if (!candidate) continue;
      const teammates = rows
        .filter((row) => row.teamNumber === self.teamNumber && row.userNum !== self.userNum)
        .map((row) => dakMap.byNumber.get(Number(row.characterNum)))
        .filter(Boolean)
        .sort();
      if (teammates.length === 0) continue;

      const placement = Number(self.gameRank);
      const rowData = { placement, oneTrickRatio: ranker.oneTrickRatio };
      aggregateRow(compositionMap, `${teammates.join("+")}=>${candidate}`, rowData);
      aggregateRow(candidateMap, candidate, rowData);
    }
  }

  const rankerCompositionStats = [...compositionMap.entries()]
    .map(([key, value]) => {
      const [teammates, candidate] = key.split("=>");
      return {
        teammates: teammates.split("+"),
        candidate,
        ...summarizeAggregate(value),
      };
    })
    .filter((row) => row.games >= 1)
    .sort((a, b) => b.games - a.games || b.top3Rate - a.top3Rate);

  const rankerCandidateStats = Object.fromEntries(
    [...candidateMap.entries()]
      .map(([candidate, value]) => [candidate, summarizeAggregate(value)])
      .filter(([, value]) => value.games >= 2)
      .sort((a, b) => b[1].games - a[1].games),
  );

  return { rankerCompositionStats, rankerCandidateStats };
}

function formatObject(value) {
  return JSON.stringify(value, null, 2).replace(/"([a-zA-Z_][a-zA-Z0-9_]*)":/g, "$1:");
}

function buildMetaFile({ seasonKey, generatedAt, experimentTiers, rankerCompositionStats, rankerCandidateStats }) {
  return `export const DAK_META_SOURCE = {
  leaderboard: "https://dak.gg/er/leaderboard",
  statistics: "https://dak.gg/er/statistics",
  seasonKey: "${seasonKey}",
  generatedAt: "${generatedAt}",
};

export const statsTierBuckets = {
  all: "all",
  iron_bronze: "bronze",
  silver_gold: "gold",
  platinum_diamond: "diamond_plus",
  meteor_mithril: "mithril_plus",
  demigod_eternity: "mithril_plus",
};

export const tierScoreWeights = {
  OP: 1.4,
  S: 1.1,
  A: 0.75,
  B: 0.3,
  C: -0.25,
  D: -0.65,
};

export const experimentTiers = ${formatObject(experimentTiers)};

export const rankerCompositionStats = ${formatObject(rankerCompositionStats)};

export const rankerCandidateStats = ${formatObject(rankerCandidateStats)};

export function statsBucketForTier(tier) {
  return statsTierBuckets[tier] ?? "all";
}

export function oneTrickWeight(oneTrickRatio = 0) {
  if (oneTrickRatio >= 0.82) return 0.15;
  if (oneTrickRatio >= 0.68) return 0.35;
  if (oneTrickRatio >= 0.52) return 0.65;
  return 1;
}

export function placementScore({ avgPlacement, winRate = 0, top3Rate = 0 }) {
  const placement = typeof avgPlacement === "number" ? (4.5 - avgPlacement) / 3.5 : 0;
  const top3 = top3Rate - 0.375;
  const win = winRate - 0.125;
  const score = placement * 1.35 + top3 * 1.15 + win * 1.45;
  return Math.max(-2.4, Math.min(2.8, score));
}
`;
}

async function main() {
  const options = parseArgs();
  const seasonKey = options.seasonKey ?? await getCurrentSeason(options.locale, options.delayMs);
  const localByName = readLocalCharacters(await fs.readFile(DATA_PATH, "utf8"));

  console.log(`season: ${seasonKey}`);
  console.log(`rankers: ${options.rankers}, matches per ranker: ${options.matchesPerRanker}`);

  const { rankers, characterById } = await collectLeaderboard(options, seasonKey);
  const dakMap = buildDakCharacterMap(characterById, localByName);
  console.log(`leaderboard rows: ${rankers.length}`);

  const experimentTiers = await collectCharacterTiers(options, dakMap);
  const { rankerCompositionStats, rankerCandidateStats } = await collectRankerStats(options, rankers, dakMap, seasonKey);

  const metaFile = buildMetaFile({
    seasonKey,
    generatedAt: new Date().toISOString(),
    experimentTiers,
    rankerCompositionStats,
    rankerCandidateStats,
  });
  await fs.mkdir(path.dirname(options.output), { recursive: true });
  await fs.writeFile(options.output, metaFile, "utf8");
  console.log(`wrote ${path.relative(ROOT, options.output)}`);
  console.log(`composition rows: ${rankerCompositionStats.length}`);
  console.log(`candidate rows: ${Object.keys(rankerCandidateStats).length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
