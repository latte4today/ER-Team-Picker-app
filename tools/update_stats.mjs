/**
 * update_stats.mjs
 * experimentTiers + statisticsPerformance 만 갱신합니다.
 * rankerCompositionStats / rankerCandidateStats 는 건드리지 않습니다.
 *
 * 사용법:
 *   node tools/update_stats.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CACHE_DIR = path.join(ROOT, "data", "dak-cache");
const META_PATH = path.join(ROOT, "src", "metaData.js");
const DATA_PATH = path.join(ROOT, "src", "data.js");
const API_BASE = "https://er.dakgg.io";

const DELAY_MS = 650;
const TIER_BUCKETS = [
  ["platinum_plus", "platinum_plus"],
  ["diamond_plus", "diamond_plus"],
  ["mithril_plus", "mithril_plus"],
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cacheName(url) {
  return Buffer.from(url).toString("base64url") + ".json";
}

async function fetchJson(url) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, cacheName(url));
  try {
    const raw = await fs.readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw);
    // {} 는 무효화된 캐시로 간주
    if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
      return parsed;
    }
  } catch {
    // 캐시 미스
  }

  console.log(`  fetching: ${url}`);
  const response = await fetch(url, {
    headers: { "Dakgg-Language": "ko", "User-Agent": "Mozilla/5.0 ER-Team-Picker/stats-updater" },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  const payload = await response.json();
  await fs.writeFile(cachePath, JSON.stringify(payload), "utf8");
  await sleep(DELAY_MS);
  return payload;
}

function normalizeName(name) {
  return String(name ?? "").replace(/\s+/g, "").toLowerCase();
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
  for (const [id, character] of Object.entries(characterById ?? {})) {
    const localId = localByName.get(normalizeName(character.name));
    if (!localId) continue;
    byNumber.set(Number(id), localId);
  }
  return { byNumber };
}

function formatObject(obj) {
  return JSON.stringify(obj, null, 2);
}

async function getCharacterMap() {
  // leaderboard p1 에서 characterById 가져오기 (캐시 있으면 재활용)
  const seasonUrl = `${API_BASE}/api/v0/current-season?hl=ko`;
  const seasonPayload = await fetchJson(seasonUrl);
  const seasonKey = seasonPayload.type;
  console.log(`시즌: ${seasonKey}`);

  const lbUrl = `${API_BASE}/api/v0/leaderboard?page=1&seasonKey=${encodeURIComponent(seasonKey)}&serverName=seoul&teamMode=SQUAD&hl=ko`;
  const lbPayload = await fetchJson(lbUrl);
  const characterById = lbPayload.characterById ?? {};

  const localByName = readLocalCharacters(await fs.readFile(DATA_PATH, "utf8"));
  return buildDakCharacterMap(characterById, localByName);
}

async function collectStats(dakMap) {
  const tiers = { all: {}, bronze: {}, gold: {}, platinum_plus: {}, diamond_plus: {}, mithril_plus: {} };
  const performance = { all: {}, bronze: {}, gold: {}, platinum_plus: {}, diamond_plus: {}, mithril_plus: {} };

  for (const [bucket, tier] of TIER_BUCKETS) {
    console.log(`통계 수집: ${bucket}`);
    const url = `${API_BASE}/api/v1/character-stats?dt=7&teamMode=SQUAD&matchingMode=RANK&tier=${tier}`;
    const payload = await fetchJson(url);
    const stats = payload.characterStatSnapshot?.characterStats ?? [];

    for (const stat of stats) {
      const localId = dakMap.byNumber.get(Number(stat.key));
      if (!localId) continue;
      const weaponStats = stat.weaponStats ?? [];
      const best = [...weaponStats].sort((a, b) => (b.count ?? 0) - (a.count ?? 0))[0];
      if (best?.tier) tiers[bucket][localId] = best.tier;

      const agg = weaponStats.reduce((s, w) => {
        s.games += w.count ?? 0;
        s.wins  += w.win   ?? 0;
        s.top3  += w.top3  ?? 0;
        s.place += w.place ?? 0;
        return s;
      }, { games: 0, wins: 0, top3: 0, place: 0 });

      if (agg.games > 0) {
        performance[bucket][localId] = {
          games: agg.games,
          avgPlacement: Number((agg.place / agg.games).toFixed(2)),
          winRate:       Number((agg.wins  / agg.games).toFixed(3)),
          top3Rate:      Number((agg.top3  / agg.games).toFixed(3)),
        };
      }
    }
  }

  tiers.all    = { ...tiers.diamond_plus };
  tiers.bronze = { ...tiers.platinum_plus };
  tiers.gold   = { ...tiers.platinum_plus };
  performance.all    = { ...performance.diamond_plus };
  performance.bronze = { ...performance.platinum_plus };
  performance.gold   = { ...performance.platinum_plus };

  return { tiers, performance };
}

async function patchMetaFile(experimentTiers, statisticsPerformance) {
  let source = await fs.readFile(META_PATH, "utf8");

  // experimentTiers 블록 교체
  source = source.replace(
    /export const experimentTiers = [\s\S]*?(?=\nexport const statisticsPerformance)/,
    `export const experimentTiers = ${formatObject(experimentTiers)};\n\n`
  );

  // statisticsPerformance 블록 교체
  source = source.replace(
    /export const statisticsPerformance = [\s\S]*?(?=\nexport const rankerCompositionStats)/,
    `export const statisticsPerformance = ${formatObject(statisticsPerformance)};\n\n`
  );

  // generatedAt 갱신
  source = source.replace(
    /generatedAt: "[^"]*"/,
    `generatedAt: "${new Date().toISOString()}"`
  );

  await fs.writeFile(META_PATH, source, "utf8");
}

async function main() {
  console.log("=== 티어표 & 통계 업데이트 시작 ===");
  const dakMap = await getCharacterMap();
  const { tiers, performance } = await collectStats(dakMap);

  console.log("metaData.js 패치 중...");
  await patchMetaFile(tiers, performance);

  const sampleCount = Object.keys(tiers.all).length;
  console.log(`✓ 완료 — ${sampleCount}개 캐릭터 티어/통계 갱신됨`);
}

main().catch((err) => { console.error(err); process.exit(1); });
