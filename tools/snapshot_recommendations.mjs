/**
 * snapshot_recommendations.mjs
 * Baseline 회귀 가드: 대표 시나리오의 추천 상위 결과(변종/추천코어/점수)를 스냅샷으로 고정하고,
 * 이후 변경이 추천을 의도치 않게 바꾸는지 비교한다. 점수 튜닝/리팩터(특히 연속화)의 안전망.
 *
 * Usage:
 *   node tools/snapshot_recommendations.mjs            # 비교 (불일치 시 exit 1)
 *   node tools/snapshot_recommendations.mjs --update   # 현재 결과를 새 기준으로 저장
 *
 * 코어는 일부러 빈 맵으로 둔다 — "특성 미선택" 기본 동작이 변하는지를 감시하기 위함.
 */

// Node에는 브라우저 전역이 없으므로 import 전에 셰임
const _store = {};
globalThis.localStorage = {
  getItem:    (k)    => _store[k] ?? null,
  setItem:    (k, v) => { _store[k] = String(v); },
  removeItem: (k)    => { delete _store[k]; },
};
globalThis.document = { documentElement: { lang: "ko" } };

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recommend, VECTOR_SCORING_FLAGS } from "../src/recommender.js";

const TIER = "all";
const TOP = 12;
const LEAN = process.argv.includes("--lean");

if (LEAN) {
  VECTOR_SCORING_FLAGS.useLeanScoring = true;
  VECTOR_SCORING_FLAGS.usePairSynergyLift = true;
}

// 역할군이 골고루 섞이도록 대표 앵커를 선정 (탱/브루저/원딜/메이지/2픽)
const SCENARIOS = [
  // 0~1픽 (zero-diff sanity: teamShape/metric/composition은 팀<3에서 0)
  [],
  ["lenox:whip"],
  ["luke:bat"],
  ["nia:pistol"],
  ["rio:bow"],
  ["lenox:whip", "rio:bow"],
  // 확장 2픽 (역할군 다양) — full vector 실험 관찰용
  ["lenox:whip", "haze:assault_rifle"],
  ["bianca:arcana", "adriana:throw"],
  ["luke:bat", "nia:pistol"],
  ["kenneth:axe", "hyunwoo:glove"],
  ["markus:axe", "hyunwoo:glove"],
  ["celine:throw", "rio:bow"],
  ["leni:pistol", "markus:axe"],
  ["estelle:axe", "haze:assault_rifle"],
  ["alonso:glove", "adriana:throw"],
  ["laura:whip", "silvia:pistol"],
];

function capture() {
  return SCENARIOS.map((selected) => ({
    selected,
    top: recommend(selected, TIER, {}).slice(0, TOP).map((r) => ({
      v: r.character.variantId,
      core: r.recommendedCore?.name ?? null,
      total: Number((r.total ?? 0).toFixed(2)),
    })),
  }));
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const snapDir = path.join(__dirname, "__snapshots__");
const snapFile = path.join(snapDir, "recommendations.json");

const current = capture();
const update = process.argv.includes("--update");

if (update || !fs.existsSync(snapFile)) {
  fs.mkdirSync(snapDir, { recursive: true });
  fs.writeFileSync(snapFile, JSON.stringify(current, null, 2) + "\n");
  console.log(`${update ? "updated" : "created"} snapshot: ${path.relative(process.cwd(), snapFile)}`);
  process.exit(0);
}

const prev = JSON.parse(fs.readFileSync(snapFile, "utf8"));
const line = (x) => (x ? `${x.v} | ${x.core} | ${x.total}` : "∅");
let diffs = 0;

for (let i = 0; i < current.length; i++) {
  const sel = current[i].selected.join(", ") || "(none)";
  const a = prev[i]?.top ?? [];
  const b = current[i].top;
  for (let j = 0; j < Math.max(a.length, b.length); j++) {
    if (line(a[j]) !== line(b[j])) {
      diffs++;
      console.log(`[${sel}] #${j + 1}`);
      console.log(`   - ${line(a[j])}`);
      console.log(`   + ${line(b[j])}`);
    }
  }
}

if (diffs) {
  console.log(`\n${diffs} difference(s) vs snapshot. 의도된 변경이면 --update 로 갱신하세요.`);
  process.exit(1);
}
console.log("snapshot OK — 추천 변화 없음.");
