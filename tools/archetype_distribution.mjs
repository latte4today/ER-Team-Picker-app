/**
 * archetype_distribution.mjs
 * 다양성 후처리(diversifyRecommendations) 전/후로 Top12가 어떤 recommendation archetype
 * 으로 구성되는지 비교 출력한다. 점수식은 무관 — 순위 재배열 효과만 관찰.
 *
 * Usage:
 *   node tools/archetype_distribution.mjs
 *   node tools/archetype_distribution.mjs --top 12
 *
 * 주의: 로컬에서만 실행. 샌드박스 마운트 사본은 잘려 신뢰 불가.
 */

const _store = {};
globalThis.localStorage = { getItem:(k)=>_store[k]??null, setItem:(k,v)=>{_store[k]=String(v);}, removeItem:(k)=>{delete _store[k];} };
globalThis.document = { documentElement: { lang: "ko" } };

import { recommend, recommendationArchetype, DIVERSITY_CONFIG } from "../src/recommender.js";
import { characterVariants } from "../src/data.js";

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const TIER = opt("--tier", "all");
const TOP = Number(opt("--top", 12));

const SCENARIOS = [
  ["kenneth:axe", "hyunwoo:glove"],
  ["markus:axe", "hyunwoo:glove"],
  ["laura:whip", "silvia:pistol"],
  ["leni:pistol", "markus:axe"],
  ["bianca:arcana", "adriana:throw"],
  ["luke:bat", "nia:pistol"],
];

const charOf = (id) => characterVariants.find((v) => v.variantId === id);

function topN(selected) {
  return recommend(selected, TIER, {}).slice(0, TOP).map((r) => ({
    id: r.character.variantId,
    arch: recommendationArchetype(r.character),
    total: r.total,
  }));
}

function distribution(list) {
  const d = {};
  for (const x of list) d[x.arch] = (d[x.arch] ?? 0) + 1;
  return Object.entries(d).sort((a, b) => b[1] - a[1]);
}

function run(selected) {
  DIVERSITY_CONFIG.enabled = false;
  const before = topN(selected);
  DIVERSITY_CONFIG.enabled = true;
  const after = topN(selected);
  return { before, after };
}

console.log(`# Top${TOP} archetype 분포: 다양성 전(before) vs 후(after)  tier=${TIER}`);
console.log(`# cap: Top6 동일 archetype ≤ ${DIVERSITY_CONFIG.top6PerArchetype}, Top12 ≤ ${DIVERSITY_CONFIG.top12PerArchetype}, 승급 점수차 한도 ${DIVERSITY_CONFIG.maxScoreDropToPromote}\n`);

for (const sel of SCENARIOS) {
  if (sel.map(charOf).some((c) => !c)) { console.log(`! 해석 실패: ${sel.join(", ")}\n`); continue; }
  const { before, after } = run(sel);

  console.log(`■ [${sel.join(", ")}]`);
  const fmtDist = (l) => distribution(l).map(([a, n]) => `${a}×${n}`).join(", ");
  console.log(`  before dist: ${fmtDist(before)}`);
  console.log(`  after  dist: ${fmtDist(after)}`);

  const fmtList = (l) => l.map((x, i) => `${i + 1}.${x.id}[${x.arch}]`).join("  ");
  console.log(`  before: ${fmtList(before)}`);
  console.log(`  after : ${fmtList(after)}`);

  // before 에서 Top6 과점 archetype 표시
  const top6 = distribution(before.slice(0, 6)).filter(([, n]) => n > DIVERSITY_CONFIG.top6PerArchetype);
  if (top6.length) console.log(`  ⚠ before Top6 과점: ${top6.map(([a, n]) => `${a}×${n}`).join(", ")}`);
  console.log("");
}

console.log("목표: 특정 archetype(control_mage/backline_dps 등)이 Top12를 과점하지 않게.");
console.log("혜진/바바라/나타폰/제니/로지는 제거가 아니라 '좋은 후보로 유지하되 비과점'이 목표.");
