/**
 * test_recommender.mjs
 * 추천 결과와 점수 분해를 콘솔에 출력합니다.
 * Usage: node tools/test_recommender.mjs [tier] [variantId1] [variantId2]
 * Example: node tools/test_recommender.mjs iron_gold jackie:bat aya:bow
 */

// Node.js doesn't have browser globals — mock them before any imports
const _store = {};
globalThis.localStorage = {
  getItem:    (k)    => _store[k] ?? null,
  setItem:    (k, v) => { _store[k] = String(v); },
  removeItem: (k)    => { delete _store[k]; },
};
globalThis.document = { documentElement: { lang: "ko" } };

import { evaluateCandidate, recommend } from "../src/recommender.js";
import { characterVariants } from "../src/data.js";

const tier     = process.argv[2] || "all";
const selected = process.argv.slice(3);

console.log(`\n=== Recommender test | tier: ${tier} | selected: [${selected.join(", ") || "(none)"}] ===\n`);

// Top 10 recommendations
const results = recommend(selected, tier, {});
const top10 = results.slice(0, 10);

console.log("Top 10 recommended:");
top10.forEach((r, i) => {
  const scores = r.scores ?? {};
  const v2     = (scores.officialV2 ?? 0).toFixed(3);
  const match  = (scores.officialMatch ?? 0).toFixed(3);
  const total  = (r.total ?? 0).toFixed(3);
  console.log(
    `  ${String(i + 1).padStart(2)}. ${r.character.variantId.padEnd(22)} ` +
    `total=${total}  officialV2=${v2}  officialMatch=${match}  tier=${r.character.tierBucket ?? "-"}`
  );
});

// Detailed breakdown of top 3
console.log("\nDetailed score breakdown (top 3):");
for (const r of top10.slice(0, 3)) {
  console.log(`\n  [${r.character.variantId}]`);
  for (const [k, v] of Object.entries(r.scores ?? {})) {
    if (Math.abs(v) > 0.001) console.log(`    ${k.padEnd(22)} ${v.toFixed(4)}`);
  }
}
