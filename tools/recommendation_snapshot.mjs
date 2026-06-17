import fs from "node:fs";
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

const cases = [
  { name: "empty-team/all/no-cores", tier: "all", selected: [], cores: {} },
  { name: "one-front/all/no-cores", tier: "all", selected: ["luke:bat"], cores: {} },
  { name: "two-picks/all/no-cores", tier: "all", selected: ["alonso:glove", "nia:pistol"], cores: {} },
  { name: "empty-team/iron_gold/no-cores", tier: "iron_gold", selected: [], cores: {} },
  { name: "empty-team/platinum_diamond/no-cores", tier: "platinum_diamond", selected: [], cores: {} },
  { name: "empty-team/meteor_mithril/no-cores", tier: "meteor_mithril", selected: [], cores: {} },
  { name: "empty-team/demigod_eternity/no-cores", tier: "demigod_eternity", selected: [], cores: {} },
];

function summarizeResult(row, index) {
  return {
    rank: index + 1,
    variantId: row.character.variantId,
    core: row.recommendedCore?.core ?? null,
    coreName: row.recommendedCore?.name ?? null,
    total: Number((row.total ?? 0).toFixed(3)),
  };
}

const snapshot = {
  generatedAt: new Date().toISOString(),
  note: "Baseline snapshot for recommendation results when no trait cores are explicitly selected.",
  cases: cases.map((item) => ({
    ...item,
    results: recommend(item.selected, item.tier, {}, undefined, [], item.cores)
      .slice(0, 10)
      .map(summarizeResult),
  })),
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
  console.error("recommendation snapshot changed");
  for (let i = 0; i < actualCases.length; i += 1) {
    const actual = actualCases[i];
    const prev = expectedCases[i];
    if (JSON.stringify(actual) === JSON.stringify(prev)) continue;
    console.error(`\n[${actual.name}]`);
    console.error("expected:", JSON.stringify(prev?.results ?? [], null, 2));
    console.error("actual:  ", JSON.stringify(actual?.results ?? [], null, 2));
  }
  process.exit(1);
}

console.log(`snapshot ok: ${path.relative(process.cwd(), snapshotPath)}`);
