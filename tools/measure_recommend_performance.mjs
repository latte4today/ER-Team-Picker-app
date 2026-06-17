import { performance } from "node:perf_hooks";

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

const iterations = Number(process.argv.find((arg) => arg.startsWith("--iterations="))?.split("=")[1] ?? 40);
const cases = [
  { name: "empty/all", tier: "all", selected: [] },
  { name: "one/luke/all", tier: "all", selected: ["luke:bat"] },
  { name: "two/alonso-nia/all", tier: "all", selected: ["alonso:glove", "nia:pistol"] },
  { name: "empty/iron_gold", tier: "iron_gold", selected: [] },
  { name: "empty/platinum_diamond", tier: "platinum_diamond", selected: [] },
  { name: "empty/meteor_mithril", tier: "meteor_mithril", selected: [] },
  { name: "empty/demigod_eternity", tier: "demigod_eternity", selected: [] },
];

function measure(item) {
  recommend(item.selected, item.tier, {}, undefined, [], {});
  const start = performance.now();
  let count = 0;
  for (let i = 0; i < iterations; i += 1) {
    count += recommend(item.selected, item.tier, {}, undefined, [], {}).length;
  }
  const elapsed = performance.now() - start;
  return {
    name: item.name,
    iterations,
    totalMs: Number(elapsed.toFixed(2)),
    avgMs: Number((elapsed / iterations).toFixed(2)),
    avgResults: Number((count / iterations).toFixed(1)),
  };
}

console.table(cases.map(measure));
