/**
 * measure_recommender_outcome.mjs
 *
 * The outcome harness the weight comments in recommender.js were tuned with.
 * It was never committed, so every one of those tables is unreproducible - and
 * the one time a weight was chosen without it (stage-1 shortlisting) the cost
 * went unmeasured and shipped. This is that harness, written down.
 *
 * Two steps, because the corpus is 5.5GB and reading it per config is absurd:
 *
 *   node tools/measure_recommender_outcome.mjs --build-sample
 *   node tools/measure_recommender_outcome.mjs --sweep fitWeight=0,0.2,0.5,1.0
 *
 * --build-sample streams the corpus once and writes a small JSON of sampled
 * teams. --sweep loads that and runs each config against it.
 *
 * Blocks, matching the ones the existing comments cite: tuning is corpus lines
 * 2.2M+, held out is 1.6M-2.1M. They are disjoint and the held-out block is
 * never used to choose anything - only to check what tuning chose. This matters:
 * `45 / 8.0 / 0` scored +8.1pp on the tuning block and +4.1pp held out, below
 * the config it was supposed to beat.
 *
 * Metrics, per config and per block:
 *
 *   gradient  Placement points of teams whose actual pick we ranked in the top
 *             12, minus everyone else, with Welch's t. Placement points are the
 *             game's own curve (1st 10, 2nd 7, 3rd 5, 4th 4, 5th 3, 6th 2,
 *             7th 1, 8th 0) rather than isTop3, which cannot tell 1st from 3rd
 *             and hid a better answer for weeks.
 *   coverage  How often the actual pick appears in the ranking at all. Measured
 *             against the FULL ranking, not the 48-row list the UI shows: with
 *             the shipped cap this reads 30% and looks like a catastrophe when
 *             it only means the roster is longer than the list.
 *   hit@k,MRR Retrieval, reported as a ratio against the random baseline k/pool
 *             so "above chance" is readable directly.
 *   rho       Spearman between where we rank a build and how that build actually
 *             places - build-level, over builds with enough games to mean
 *             anything, not a per-team number.
 *   variety   Distinct builds reaching any top 5, out of the whole pool.
 *
 * Read the held-out column. Nothing else.
 */

const _store = {};
globalThis.localStorage = {
  getItem: (k) => _store[k] ?? null,
  setItem: (k, v) => { _store[k] = String(v); },
  removeItem: (k) => { delete _store[k]; },
};
globalThis.document = { documentElement: { lang: "ko", dataset: {} } };

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { recommend, LEAN_SCORING_CONFIG, TWO_STAGE_ORDERING_WEIGHTS, DIVERSITY_CONFIG } from "../src/recommender.js";
import { characterVariants } from "../src/data.js";
import { FALLBACK_CHARACTER_CODE_TO_ID } from "./character_code_map.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CORPUS = path.join(ROOT, "data", "ml-training", "corpus.jsonl");
const SAMPLE = path.join(ROOT, "data", "ml-training", "outcome-sample.json");

// The game's own placement curve. Using it instead of isTop3 is what showed
// selectedStrengthWeight 0 to be worse than 0.30 on both blocks.
const PLACEMENT_POINTS = { 1: 10, 2: 7, 3: 5, 4: 4, 5: 3, 6: 2, 7: 1, 8: 0 };

const BLOCKS = {
  heldout: { from: 1_600_000, to: 2_100_000, teams: 1200 },
  tuning: { from: 2_200_000, to: Infinity, teams: 700 },
};

function parseArgs(argv) {
  const args = { buildSample: false, sweep: null, tier: "all", seed: 7 };
  for (let i = 2; i < argv.length; i += 1) {
    const raw = argv[i];
    if (raw === "--build-sample") args.buildSample = true;
    else if (raw === "--sweep") args.sweep = argv[++i];
    else if (raw === "--tier") args.tier = argv[++i];
    else if (raw === "--seed") args.seed = Number(argv[++i]);
    else throw new Error(`unknown argument: ${raw}`);
  }
  if (!args.buildSample && !args.sweep) args.sweep = "none";
  return args;
}

// Deterministic sampling so two runs of the same config are comparable.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const variantsByCharacter = characterVariants.reduce((map, variant) => {
  if (!map.has(variant.characterId)) map.set(variant.characterId, []);
  map.get(variant.characterId).push(variant);
  return map;
}, new Map());

// The corpus stores a weapon code, not our weapon id. build_official_stats
// infers the mapping from characters that only have one variant; same here so
// the two agree.
function inferWeaponCodes(rows) {
  const counts = new Map();
  for (const row of rows) {
    for (const player of row.players ?? []) {
      const characterId = FALLBACK_CHARACTER_CODE_TO_ID[player.character];
      if (!characterId) continue;
      const variants = variantsByCharacter.get(characterId) ?? [];
      if (variants.length !== 1) continue;
      const key = String(player.weapon);
      if (!counts.has(key)) counts.set(key, new Map());
      const inner = counts.get(key);
      inner.set(variants[0].weapon, (inner.get(variants[0].weapon) ?? 0) + 1);
    }
  }
  const map = new Map();
  for (const [code, inner] of counts) {
    const best = [...inner.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) map.set(code, best[0]);
  }
  return map;
}

function variantIdFor(player, weaponCodes) {
  const characterId = FALLBACK_CHARACTER_CODE_TO_ID[player.character];
  if (!characterId) return null;
  const variants = variantsByCharacter.get(characterId) ?? [];
  if (variants.length === 0) return null;
  if (variants.length === 1) return variants[0].variantId;
  const weapon = weaponCodes.get(String(player.weapon));
  return variants.find((v) => v.weapon === weapon)?.variantId ?? null;
}

async function buildSample() {
  const stream = fs.createReadStream(CORPUS, { encoding: "utf8", highWaterMark: 4 * 1024 * 1024 });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const raw = { tuning: [], heldout: [] };
  const reservoirSeen = { tuning: 0, heldout: 0 };
  const rng = mulberry32(11);
  const wanted = { tuning: BLOCKS.tuning.teams * 4, heldout: BLOCKS.heldout.teams * 4 };

  let lineNo = 0;
  let kept = 0;
  for await (const line of rl) {
    lineNo += 1;
    let block = null;
    if (lineNo >= BLOCKS.heldout.from && lineNo < BLOCKS.heldout.to) block = "heldout";
    else if (lineNo >= BLOCKS.tuning.from) block = "tuning";
    if (!block) continue;
    if (!line) continue;

    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (row.matchingMode !== 3 || row.seasonId !== 41) continue;
    const players = row.players ?? [];
    if (players.length !== 3) continue;
    if (!(row.rank >= 1 && row.rank <= 8)) continue;

    // Reservoir sample so the block is represented evenly rather than by
    // whatever happens to sit at its start.
    reservoirSeen[block] += 1;
    const bucket = raw[block];
    if (bucket.length < wanted[block]) {
      bucket.push(row);
    } else {
      const j = Math.floor(rng() * reservoirSeen[block]);
      if (j < wanted[block]) bucket[j] = row;
    }
    kept += 1;
    if (lineNo % 250000 === 0) {
      process.stderr.write(`  line ${(lineNo / 1e6).toFixed(2)}M, kept ${kept}\n`);
    }
  }

  const weaponCodes = inferWeaponCodes([...raw.tuning, ...raw.heldout]);
  const out = {};
  for (const [block, rows] of Object.entries(raw)) {
    const teams = [];
    for (const row of rows) {
      const members = row.players.map((player) => ({
        variantId: variantIdFor(player, weaponCodes),
        core: player.traits?.core ? String(player.traits.core) : null,
      }));
      if (members.some((m) => !m.variantId)) continue;
      if (new Set(members.map((m) => m.variantId.split(":")[0])).size !== 3) continue;
      teams.push({ members, rank: row.rank, tierBucket: row.tierBucket ?? "all" });
      if (teams.length >= BLOCKS[block].teams) break;
    }
    out[block] = teams;
  }

  fs.writeFileSync(SAMPLE, JSON.stringify({
    generatedAt: new Date().toISOString(),
    corpusLines: lineNo,
    blocks: BLOCKS,
    counts: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])),
    teams: out,
  }));
  console.log(`scanned ${(lineNo / 1e6).toFixed(2)}M lines, kept ${kept} eligible teams`);
  console.log(`sample: ${Object.entries(out).map(([k, v]) => `${k} ${v.length}`).join(", ")} -> ${path.relative(ROOT, SAMPLE)}`);
}

function welchT(a, b) {
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const varOf = (xs, m) => xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1);
  if (a.length < 2 || b.length < 2) return { diff: 0, t: 0 };
  const ma = mean(a);
  const mb = mean(b);
  const se = Math.sqrt(varOf(a, ma) / a.length + varOf(b, mb) / b.length);
  return { diff: ma - mb, t: se > 0 ? (ma - mb) / se : 0 };
}

function spearman(xs, ys) {
  const rank = (values) => {
    const order = values.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
    const out = new Array(values.length);
    for (let i = 0; i < order.length;) {
      let j = i;
      while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j += 1;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k += 1) out[order[k][1]] = avg;
      i = j + 1;
    }
    return out;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const n = xs.length;
  const mx = rx.reduce((s, v) => s + v, 0) / n;
  const my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i += 1) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
}

function evaluateBlock(teams, tier) {
  const inList = [];
  const outList = [];
  let found = 0;
  let attempts = 0;
  let mrr = 0;
  let hit1 = 0, hit3 = 0, hit12 = 0;
  let poolSum = 0;
  const variety = new Set();
  // Build-level: where we rank a build, against how that build actually places.
  const appRankSum = new Map();
  const appRankN = new Map();
  const playedPoints = new Map();
  const playedN = new Map();

  for (const team of teams) {
    const points = PLACEMENT_POINTS[team.rank] ?? 0;
    let anyInTop12 = false;

    for (let held = 0; held < 3; held += 1) {
      const others = team.members.filter((_, i) => i !== held);
      const target = team.members[held];
      // Real cores from the match, so the teammates are the builds they played.
      const cores = {};
      for (const member of others) if (member.core) cores[member.variantId] = member.core;

      const list = recommend(
        others.map((m) => m.variantId),
        tier,
        {},
        undefined,
        [],
        cores,
      );
      const builds = [];
      for (const row of list) {
        const id = row.character.variantId;
        if (!builds.includes(id)) builds.push(id);
      }
      builds.slice(0, 5).forEach((id) => variety.add(id));

      attempts += 1;
      poolSum += Math.max(1, builds.length);
      builds.forEach((id, at) => {
        appRankSum.set(id, (appRankSum.get(id) ?? 0) + at);
        appRankN.set(id, (appRankN.get(id) ?? 0) + 1);
      });

      const at = builds.indexOf(target.variantId);
      if (at >= 0) {
        found += 1;
        mrr += 1 / (at + 1);
        if (at < 1) hit1 += 1;
        if (at < 3) hit3 += 1;
        if (at < 12) { hit12 += 1; anyInTop12 = true; }
      }
    }

    for (const member of team.members) {
      playedPoints.set(member.variantId, (playedPoints.get(member.variantId) ?? 0) + points);
      playedN.set(member.variantId, (playedN.get(member.variantId) ?? 0) + 1);
    }
    (anyInTop12 ? inList : outList).push(points);
  }

  // 30 games before a build's own placement average is worth correlating against.
  const rhoRanks = [];
  const rhoPoints = [];
  for (const [id, n] of playedN) {
    if (n < 30 || !appRankN.has(id)) continue;
    rhoRanks.push(appRankSum.get(id) / appRankN.get(id));
    rhoPoints.push(playedPoints.get(id) / n);
  }

  const meanPool = poolSum / Math.max(1, attempts);
  const ratio = (hits, k) => {
    const baseline = Math.min(1, k / meanPool);
    return baseline > 0 ? (hits / attempts) / baseline : 0;
  };
  const grad = welchT(inList, outList);

  return {
    teams: teams.length,
    gradient: grad.diff,
    t: grad.t,
    inN: inList.length,
    outN: outList.length,
    coverage: found / attempts,
    hit1: ratio(hit1, 1),
    hit3: ratio(hit3, 3),
    hit12: ratio(hit12, 12),
    mrr: (mrr / attempts) / (Math.log(meanPool) / meanPool || 1),
    rho: rhoRanks.length >= 10 ? -spearman(rhoRanks, rhoPoints) : NaN,
    rhoN: rhoRanks.length,
    variety: variety.size,
  };
}

function applyConfig(spec) {
  // Stage 2 swaps in TWO_STAGE_ORDERING_WEIGHTS, so a knob has to be set in both
  // places or the sweep silently measures the shipped value once teammates exist.
  const restore = [];
  if (spec === "none") return () => {};
  for (const part of spec.split(";")) {
    const [key, value] = part.split("=");
    const num = Number(value);
    restore.push([LEAN_SCORING_CONFIG, key, LEAN_SCORING_CONFIG[key]]);
    LEAN_SCORING_CONFIG[key] = num;
    if (key in TWO_STAGE_ORDERING_WEIGHTS) {
      restore.push([TWO_STAGE_ORDERING_WEIGHTS, key, TWO_STAGE_ORDERING_WEIGHTS[key]]);
      TWO_STAGE_ORDERING_WEIGHTS[key] = num;
    }
  }
  return () => { for (const [target, key, old] of restore) target[key] = old; };
}

async function sweep(spec, tier) {
  if (!fs.existsSync(SAMPLE)) {
    throw new Error(`no sample at ${path.relative(ROOT, SAMPLE)}; run --build-sample first`);
  }
  const sample = JSON.parse(fs.readFileSync(SAMPLE, "utf8"));
  console.log(`sample: ${Object.entries(sample.counts).map(([k, v]) => `${k} ${v}`).join(", ")} teams`
    + ` from ${(sample.corpusLines / 1e6).toFixed(2)}M corpus lines\n`);

  // "fitWeight=0,0.2,0.5" -> one config per value. Multiple knobs with ';'.
  const configs = [];
  if (spec === "none") {
    configs.push({ label: "shipped", spec: "none" });
  } else {
    const [key, values] = spec.includes("=") ? spec.split("=") : [spec, ""];
    for (const value of values.split(",")) {
      configs.push({ label: `${key}=${value}`, spec: `${key}=${value}` });
    }
  }

  const header = "config".padEnd(18) + "block".padEnd(10)
    + "gradient".padStart(10) + "t".padStart(7) + "coverage".padStart(10)
    + "hit@12".padStart(8) + "hit@3".padStart(7) + "MRR".padStart(7)
    + "rho".padStart(7) + "variety".padStart(9);
  console.log(header);
  console.log("-".repeat(header.length));

  // recommend() caps at 48 rows for the UI. Measuring retrieval against a capped
  // list makes coverage a statement about the cap, not about the ranking.
  const shippedCap = DIVERSITY_CONFIG.resultCap;
  DIVERSITY_CONFIG.resultCap = 1000;
  try {
  for (const config of configs) {
    const restore = applyConfig(config.spec);
    try {
      for (const block of ["tuning", "heldout"]) {
        const teams = sample.teams[block] ?? [];
        if (!teams.length) continue;
        const r = evaluateBlock(teams, tier);
        console.log(
          config.label.padEnd(18) + block.padEnd(10)
          + `${r.gradient >= 0 ? "+" : ""}${r.gradient.toFixed(3)}`.padStart(10)
          + r.t.toFixed(2).padStart(7)
          + `${(100 * r.coverage).toFixed(1)}%`.padStart(10)
          + `${r.hit12.toFixed(2)}x`.padStart(8)
          + `${r.hit3.toFixed(2)}x`.padStart(7)
          + `${r.mrr.toFixed(2)}x`.padStart(7)
          + r.rho.toFixed(3).padStart(7)
          + String(r.variety).padStart(9),
        );
      }
    } finally {
      restore();
    }
  }
  } finally {
    DIVERSITY_CONFIG.resultCap = shippedCap;
  }
  console.log("\nRead the heldout rows. The tuning block has chosen wrong before.");
}

const args = parseArgs(process.argv);
if (args.buildSample) await buildSample();
else await sweep(args.sweep, args.tier);
