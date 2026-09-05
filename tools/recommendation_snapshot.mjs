import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (!globalThis.localStorage) {
  const store = {};
  globalThis.localStorage = {
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
  };
}

if (!globalThis.document) {
  globalThis.document = { documentElement: { lang: "ko", dataset: {} } };
}

const { recommend } = await import("../src/recommender.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const snapshotPath = path.resolve(__dirname, "../snapshots/recommendation-baseline.json");
const update = process.argv.includes("--update");

// This guard used to be 7 cases, five of them empty teams. Two-stage ranking only
// engages once something is picked, so it was effectively watching two contexts -
// and on 2026-09-05 it passed a change that moved 3,600 held-out evaluations
// (coverage 73% -> 100%, top-5 variety 95 -> 110 variants). Passing was not
// evidence of no change; it was evidence of a thin guard.
//
// Seeds are held fixed rather than derived from an index into the roster, so
// adding a character does not silently reshuffle every case. Unknown ids are
// skipped with a warning instead of crashing, for when a variant is retired.
const SEEDS = [
  "luke:bat",          // frontline
  "garnet:bat",        // frontline
  "alonso:glove",      // bruiser
  "nicky:glove",       // bruiser
  "daniel:dagger",     // assassin
  "nia:pistol",        // mage
  "nadine:bow",        // mage
  "rozzi:pistol",      // ranged
  "rio:bow",           // ranged
  "leni:pistol",       // support
  "charlotte:arcana",  // support
];
const TIERS = ["all", "iron_gold", "platinum_diamond", "meteor_mithril", "demigod_eternity"];

const { characterVariants } = await import("../src/data.js");
const known = new Set(characterVariants.map((v) => v.variantId));
const seeds = SEEDS.filter((id) => {
  if (known.has(id)) return true;
  console.warn(`skipping unknown snapshot seed: ${id}`);
  return false;
});

const cases = [];
for (const tier of TIERS) {
  cases.push({ name: `empty-team/${tier}/no-cores`, tier, selected: [], cores: {} });
  for (const seed of seeds) {
    cases.push({ name: `one-pick/${tier}/${seed}`, tier, selected: [seed], cores: {} });
  }
  // Pair each seed with the next, so every seed appears on both sides of a two-pick
  // context without generating the full grid.
  for (let i = 0; i < seeds.length; i += 1) {
    const a = seeds[i];
    const b = seeds[(i + 1) % seeds.length];
    if (a.split(":")[0] === b.split(":")[0]) continue;
    cases.push({ name: `two-pick/${tier}/${a}+${b}`, tier, selected: [a, b], cores: {} });
  }
}

function summarizeResult(row, index) {
  return {
    rank: index + 1,
    variantId: row.character.variantId,
    core: row.recommendedCore?.core ?? null,
    coreName: row.recommendedCore?.name ?? null,
    total: Number((row.total ?? 0).toFixed(3)),
  };
}

// The top 10 catches what a user would notice; the digest catches everything else,
// including a reordering of the tail or a candidate dropping out of the list.
function digestOf(rows) {
  const text = rows
    .map((row) => `${row.character.variantId}#${row.recommendedCore?.core ?? ""}:${(row.total ?? 0).toFixed(4)}`)
    .join(",");
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

const snapshot = {
  generatedAt: new Date().toISOString(),
  note: "Baseline snapshot for recommendation results when no trait cores are explicitly selected.",
  cases: cases.map((item) => {
    const rows = recommend(item.selected, item.tier, {}, undefined, [], item.cores);
    return {
      ...item,
      count: rows.length,
      digest: digestOf(rows),
      results: rows.slice(0, 10).map(summarizeResult),
    };
  }),
};

if (update) {
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(`updated snapshot: ${path.relative(process.cwd(), snapshotPath)}`);
  process.exit(0);
}

if (!fs.existsSync(snapshotPath)) {
  console.error(`snapshot missing: ${path.relative(process.cwd(), snapshotPath)}`);
  console.error("run: node tools/recommendation_snapshot.mjs --update");
  process.exit(1);
}

const expected = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
const actualCases = snapshot.cases.map(({ generatedAt, note, ...item }) => item);
const expectedCases = expected.cases.map(({ generatedAt, note, ...item }) => item);

if (JSON.stringify(actualCases) !== JSON.stringify(expectedCases)) {
  const changed = actualCases.filter((actual, i) => JSON.stringify(actual) !== JSON.stringify(expectedCases[i]));
  console.error(`recommendation snapshot changed: ${changed.length} of ${actualCases.length} cases`);
  for (const actual of changed.slice(0, 5)) {
    const prev = expectedCases.find((c) => c.name === actual.name);
    console.error(`\n[${actual.name}]  digest ${prev?.digest ?? "?"} -> ${actual.digest}  (${prev?.count ?? "?"} -> ${actual.count} rows)`);
    console.error("expected top 3:", JSON.stringify((prev?.results ?? []).slice(0, 3)));
    console.error("actual   top 3:", JSON.stringify((actual.results ?? []).slice(0, 3)));
  }
  if (changed.length > 5) console.error(`\n... and ${changed.length - 5} more`);
  process.exit(1);
}

console.log(`snapshot ok: ${path.relative(process.cwd(), snapshotPath)}`);
