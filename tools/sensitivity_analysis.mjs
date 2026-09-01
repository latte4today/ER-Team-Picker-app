/**
 * sensitivity_analysis.mjs — global sensitivity analysis (GSA) of the recommender's
 * scoring weights.
 *
 * The lean scoring path has ~18 hand-tuned weights in LEAN_SCORING_CONFIG. Nobody
 * knows which of them the output actually depends on. This answers that by varying
 * them all at once over plausible ranges and decomposing the variance of the result.
 *
 * Two outputs, because "does this weight matter" has two different meanings:
 *
 *   stability  How much the top-K recommendation set moves when the weight moves.
 *              High sensitivity = the ranking users see is balanced on that knob, so
 *              it needs careful calibration and the recommendation is less reproducible.
 *   ranking    Kendall tau against the shipped-default ranking. Same idea, whole-list.
 *
 * Two estimators:
 *
 *   --method morris  Elementary effects (Morris). r*(k+1) runs. Cheap screening:
 *                    separates "matters" from "does not matter" and flags non-linear
 *                    or interacting weights (high sigma relative to mu*).
 *   --method sobol   Saltelli sampling -> first-order (S1) and total-order (ST)
 *                    variance indices. N*(k+2) runs. S1 is the weight acting alone,
 *                    ST includes all its interactions; ST - S1 is the interaction mass.
 *
 * Usage:
 *   node tools/sensitivity_analysis.mjs --method morris --r 24
 *   node tools/sensitivity_analysis.mjs --method sobol --n 128 --topk 5
 *   node tools/sensitivity_analysis.mjs --method morris --spread 0.5 --json-out reports/gsa.json
 *
 * --spread is the fractional range around each shipped default (0.35 = +/-35%).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (!globalThis.localStorage) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { recommend, updateOfficialStats, LEAN_SCORING_CONFIG } = await import(`file://${path.join(ROOT, "src", "recommender.js").replace(/\\/g, "/")}`);
const { characterVariants } = await import(`file://${path.join(ROOT, "src", "data.js").replace(/\\/g, "/")}`);

// The app fetches the compact stats at runtime and calls updateOfficialStats; the
// bundled officialMatchStats.js is only the offline fallback. Analysing without this
// measures a model no user actually sees.
{
  const compactPath = path.join(ROOT, 'src', 'officialMatchStats.compact.json');
  try {
    const compact = JSON.parse(fs.readFileSync(compactPath, 'utf8'));
    updateOfficialStats(compact);
    const meta = compact.source ?? {};
    console.log("stats: compact " + (meta.generatedAt ?? "?")
      + " (" + (meta.validTeams ?? "?") + " teams, matchingMode="
      + (meta.matchingMode ?? "any") + ")");
  } catch (error) {
    console.warn("WARNING: falling back to bundled stats - " + error.message);
  }
}

const DEFAULTS = { ...LEAN_SCORING_CONFIG };
const PARAMS = Object.keys(DEFAULTS);

function parseArgs() {
  const args = { method: "morris", r: 20, n: 64, topk: 5, spread: 0.35, seed: 1, jsonOut: null };
  for (let i = 2; i < process.argv.length; i += 1) {
    const key = process.argv[i];
    if (!key.startsWith("--")) continue;
    const value = process.argv[i + 1];
    i += 1;
    const option = key.slice(2);
    if (["r", "n", "topk", "seed"].includes(option)) args[option] = Number(value);
    else if (option === "spread") args.spread = Number(value);
    else if (option === "method") args.method = String(value);
    else if (option === "json-out") args.jsonOut = path.resolve(ROOT, value);
  }
  return args;
}

// Deterministic PRNG so a reported index is reproducible from --seed alone.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A weight only matters relative to the contexts that actually reach it. A purely
// random panel misses rare branches: the first version of this file reported
// stackPenaltyCap as a dead knob (mu* = 0) purely because no sampled pair was a
// same-role skill-backline stack, the only shape that pushes the penalty past the
// cap. Moving that cap in a hand-built stack scenario swings the total by ~0.5.
// So the panel is stratified: one deliberate context per branch we know exists,
// plus random draws for coverage of everything else.
function buildPanel(rng) {
  const ids = characterVariants.map((v) => v.variantId);
  const byRole = (role, damage) => characterVariants.filter(
    (v) => v.role === role && (damage === undefined || v.damage === damage),
  );
  const two = (list) => list.slice(0, 2).map((v) => v.variantId);
  const distinct = (pair) => pair.length === 2 && pair[0].split(":")[0] !== pair[1].split(":")[0];

  // Shapes chosen to activate specific scoring branches.
  const shapes = [
    two(byRole("mage", "skill")),        // same-role skill backline -> stack penalty past cap
    two(byRole("ranged")),               // double backline, no frontline
    two(byRole("frontline")),            // double frontline, no damage
    two(byRole("support")),              // double support -> composition guide penalty
    two(byRole("assassin")),             // double dive, no frontline, no cc
    [byRole("frontline")[0]?.variantId, byRole("ranged")[0]?.variantId],  // textbook balanced
    [byRole("frontline")[0]?.variantId, byRole("support")[0]?.variantId], // front + support, no dealer
    [byRole("bruiser")[0]?.variantId, byRole("mage")[0]?.variantId],
  ].filter((pair) => pair.every(Boolean) && distinct(pair));

  const singles = ["frontline", "bruiser", "ranged", "assassin", "mage", "support"]
    .map((role) => byRole(role)[0]?.variantId)
    .filter(Boolean);

  const pick = () => ids[Math.floor(rng() * ids.length)];
  const tiers = ["all", "platinum_diamond", "meteor_mithril"];
  const panel = [];
  for (const tier of tiers) {
    panel.push({ tier, selected: [] });
    for (const id of singles) panel.push({ tier, selected: [id] });
    for (const pair of shapes) panel.push({ tier, selected: pair });
    for (let i = 0; i < 4; i += 1) {
      const a = pick();
      let b = pick();
      while (b.split(":")[0] === a.split(":")[0]) b = pick();
      panel.push({ tier, selected: [a, b] });
    }
  }
  return panel;
}

function applyWeights(vector) {
  PARAMS.forEach((name, index) => { LEAN_SCORING_CONFIG[name] = vector[index]; });
}

function restoreDefaults() {
  PARAMS.forEach((name) => { LEAN_SCORING_CONFIG[name] = DEFAULTS[name]; });
}

function rankingFor(panel, topk) {
  return panel.map(({ selected, tier }) => {
    const results = recommend(selected, tier);
    return {
      top: results.slice(0, topk).map((r) => r.character.variantId),
      order: results.map((r) => r.character.variantId),
    };
  });
}

function jaccard(a, b) {
  const setB = new Set(b);
  const shared = a.filter((x) => setB.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 1 : shared / union;
}

// Kendall tau over the items the two orderings share, computed from rank positions.
function kendallTau(a, b) {
  const posB = new Map(b.map((id, i) => [id, i]));
  const shared = a.filter((id) => posB.has(id));
  const n = shared.length;
  if (n < 2) return 1;
  const seq = shared.map((id) => posB.get(id));
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (seq[i] < seq[j]) concordant += 1;
      else if (seq[i] > seq[j]) discordant += 1;
    }
  }
  const pairs = (n * (n - 1)) / 2;
  return pairs === 0 ? 1 : (concordant - discordant) / pairs;
}

/**
 * Model output: how far this weight vector moves the recommendation away from the
 * shipped default. 0 = identical to what ships, 1 = completely different top-K.
 * Sensitivity of THIS is what tells you which knobs the user-visible list rides on.
 */
function makeEvaluator(panel, topk, baseline) {
  let calls = 0;
  return {
    get calls() { return calls; },
    run(vector) {
      applyWeights(vector);
      const current = rankingFor(panel, topk);
      calls += 1;
      let topDrift = 0;
      let tauDrift = 0;
      for (let i = 0; i < panel.length; i += 1) {
        topDrift += 1 - jaccard(baseline[i].top, current[i].top);
        tauDrift += (1 - kendallTau(baseline[i].order, current[i].order)) / 2;
      }
      return { stability: topDrift / panel.length, ranking: tauDrift / panel.length };
    },
  };
}

function bounds(spread) {
  return PARAMS.map((name) => {
    const base = DEFAULTS[name];
    const delta = Math.abs(base) * spread;
    // Weights are magnitudes; letting them cross zero would flip a term's meaning
    // and measure a different model, not this one's sensitivity.
    return [Math.max(0, base - delta), base + delta];
  });
}

function scaleVector(unit, box) {
  return unit.map((u, i) => box[i][0] + u * (box[i][1] - box[i][0]));
}

function morris(evaluate, box, r, rng, metrics) {
  const k = PARAMS.length;
  const levels = 8;
  const delta = levels / (2 * (levels - 1));
  const effects = Object.fromEntries(metrics.map((m) => [m, PARAMS.map(() => [])]));

  for (let trajectory = 0; trajectory < r; trajectory += 1) {
    const base = Array.from({ length: k }, () => Math.floor(rng() * (levels / 2)) / (levels - 1));
    const order = PARAMS.map((_, i) => i).sort(() => rng() - 0.5);
    let point = [...base];
    let previous = evaluate(scaleVector(point, box));
    for (const index of order) {
      const next = [...point];
      next[index] = point[index] + (point[index] + delta > 1 ? -delta : delta);
      const step = next[index] - point[index];
      const current = evaluate(scaleVector(next, box));
      for (const metric of metrics) {
        effects[metric][index].push((current[metric] - previous[metric]) / step);
      }
      point = next;
      previous = current;
    }
  }

  const out = {};
  for (const metric of metrics) {
    out[metric] = PARAMS.map((name, index) => {
      const values = effects[metric][index];
      const muStar = values.reduce((sum, v) => sum + Math.abs(v), 0) / values.length;
      const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
      const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / Math.max(1, values.length - 1);
      return { name, muStar, mu: mean, sigma: Math.sqrt(variance) };
    }).sort((a, b) => b.muStar - a.muStar);
  }
  return out;
}

function sobol(evaluate, box, n, rng, metrics) {
  const k = PARAMS.length;
  const A = Array.from({ length: n }, () => Array.from({ length: k }, () => rng()));
  const B = Array.from({ length: n }, () => Array.from({ length: k }, () => rng()));

  const evalMatrix = (matrix) => matrix.map((row) => evaluate(scaleVector(row, box)));
  const yA = evalMatrix(A);
  const yB = evalMatrix(B);
  const yAB = [];
  for (let i = 0; i < k; i += 1) {
    const ABi = A.map((row, j) => { const copy = [...row]; copy[i] = B[j][i]; return copy; });
    yAB.push(evalMatrix(ABi));
  }

  const out = {};
  for (const metric of metrics) {
    const a = yA.map((v) => v[metric]);
    const b = yB.map((v) => v[metric]);
    const mean = [...a, ...b].reduce((s, v) => s + v, 0) / (2 * n);
    const varY = [...a, ...b].reduce((s, v) => s + (v - mean) ** 2, 0) / (2 * n - 1);
    out[metric] = PARAMS.map((name, i) => {
      const ab = yAB[i].map((v) => v[metric]);
      // Saltelli 2010 estimators.
      const s1 = a.reduce((s, av, j) => s + b[j] * (ab[j] - av), 0) / n / (varY || 1);
      const st = a.reduce((s, av, j) => s + (av - ab[j]) ** 2, 0) / (2 * n) / (varY || 1);
      return { name, S1: s1, ST: st, interaction: Math.max(0, st - s1) };
    }).sort((x, y) => y.ST - x.ST);
    out[`${metric}__variance`] = varY;
  }
  return out;
}

function fmt(value, width = 8, digits = 4) {
  return Number(value).toFixed(digits).padStart(width);
}

const args = parseArgs();
const rng = mulberry32(args.seed);
const panel = buildPanel(rng);
const box = bounds(args.spread);
const metrics = ["stability", "ranking"];

console.log(`GSA of LEAN_SCORING_CONFIG`);
console.log(`  method=${args.method} params=${PARAMS.length} panel=${panel.length} topK=${args.topk} spread=+/-${(args.spread * 100).toFixed(0)}% seed=${args.seed}`);

restoreDefaults();
const baseline = rankingFor(panel, args.topk);
const evaluator = makeEvaluator(panel, args.topk, baseline);
const started = Date.now();

let result;
if (args.method === "sobol") {
  console.log(`  sobol runs = N*(k+2) = ${args.n}*(${PARAMS.length}+2) = ${args.n * (PARAMS.length + 2)}`);
  result = sobol((v) => evaluator.run(v), box, args.n, rng, metrics);
} else {
  console.log(`  morris runs = r*(k+1) = ${args.r}*(${PARAMS.length}+1) = ${args.r * (PARAMS.length + 1)}`);
  result = morris((v) => evaluator.run(v), box, args.r, rng, metrics);
}
restoreDefaults();

const elapsed = ((Date.now() - started) / 1000).toFixed(1);

for (const metric of metrics) {
  const label = metric === "stability" ? `top-${args.topk} set drift` : "full-ranking drift (Kendall)";
  console.log(`\n== ${metric}  (${label}) ==`);
  if (args.method === "sobol") {
    console.log(`   output variance: ${result[`${metric}__variance`].toExponential(3)}`);
    console.log(`   ${"weight".padEnd(24)} ${"S1".padStart(8)} ${"ST".padStart(8)} ${"interact".padStart(9)}`);
    for (const row of result[metric]) {
      console.log(`   ${row.name.padEnd(24)} ${fmt(row.S1)} ${fmt(row.ST)} ${fmt(row.interaction, 9)}`);
    }
  } else {
    console.log(`   ${"weight".padEnd(24)} ${"mu*".padStart(9)} ${"sigma".padStart(9)}  reading`);
    for (const row of result[metric]) {
      const reading = row.muStar < 1e-6
        ? "no effect - dead knob"
        : row.sigma > row.muStar
          ? "non-linear / interacting"
          : "roughly linear";
      console.log(`   ${row.name.padEnd(24)} ${fmt(row.muStar, 9)} ${fmt(row.sigma, 9)}  ${reading}`);
    }
  }
}

console.log(`\n${evaluator.calls} model evaluations in ${elapsed}s`);

if (args.jsonOut) {
  fs.mkdirSync(path.dirname(args.jsonOut), { recursive: true });
  fs.writeFileSync(args.jsonOut, JSON.stringify({
    generatedAt: new Date().toISOString(),
    method: args.method,
    params: PARAMS,
    defaults: DEFAULTS,
    spread: args.spread,
    seed: args.seed,
    topk: args.topk,
    panelSize: panel.length,
    evaluations: evaluator.calls,
    result,
  }, null, 2));
  console.log(`wrote ${path.relative(ROOT, args.jsonOut)}`);
}
