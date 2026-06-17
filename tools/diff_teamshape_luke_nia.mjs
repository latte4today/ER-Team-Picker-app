/**
 * diff_teamshape_luke_nia.mjs
 * [luke:bat, nia:pistol] 시나리오에서 legacy vs vector teamShapeScore의 후보별 영향 비교.
 *
 * 후보별 출력: legacy total / vector total / 점수 차이 / legacy teamShapeScore /
 * vectorTeamShapeScore / teamVector sum(6축).
 *
 * Usage:
 *   node tools/diff_teamshape_luke_nia.mjs
 *   node tools/diff_teamshape_luke_nia.mjs --tier diamond
 *
 * 주의: 로컬에서만 실행. 샌드박스 마운트 사본은 잘려 신뢰 불가.
 * 이 스크립트는 snapshot 을 변경하지 않는다(--update 안 함).
 */

// i18n t() 가 참조하므로 import 전에 셰임.
const _store = {};
globalThis.localStorage = {
  getItem:    (k)    => _store[k] ?? null,
  setItem:    (k, v) => { _store[k] = String(v); },
  removeItem: (k)    => { delete _store[k]; },
};
globalThis.document = { documentElement: { lang: "ko" } };

import { evaluateCandidate, teamVector, VECTOR_SCORING_FLAGS } from "../src/recommender.js";
import { characterVariants } from "../src/data.js";

const argv = process.argv.slice(2);
let tier = "all";
for (let i = 0; i < argv.length; i++) if (argv[i] === "--tier") tier = argv[++i] ?? "all";

const SELECTED = ["luke:bat", "nia:pistol"];

// [표시이름, 캐릭터키, 무기키워드] — variantId 정확 슬러그를 몰라도 느슨하게 해석.
const TARGETS = [
  ["Bernice sniper",  "bernice",  "sniper"],
  ["Aya assault",     "aya",      "assault"],
  ["Emma arcana",     "emma",     "arcana"],
  ["Hyejin shuriken", "hyejin",   "shuriken"],
  ["Zahir shuriken",  "zahir",    "shuriken"],
  ["Nathapon camera", "nathapon", "camera"],
  ["Jenny pistol",    "jenny",    "pistol"],
  ["Sissela shuriken","sissela",  "shuriken"],
];

function resolve(charKey, weaponKw) {
  const k = charKey.toLowerCase(), w = weaponKw.toLowerCase();
  return characterVariants.find((v) => {
    const id = String(v.variantId).toLowerCase();
    const [cp, wp = ""] = id.split(":");
    const nameMatch =
      cp.includes(k) ||
      String(v.characterId).toLowerCase().includes(k) ||
      (v.name || "").toLowerCase().includes(k);
    const wpMatch =
      wp.includes(w) ||
      (v.weaponLabel || "").toLowerCase().includes(w) ||
      (v.weapon || "").toLowerCase().includes(w);
    return nameMatch && wpMatch;
  });
}

function evalWith(useVector, variantId) {
  VECTOR_SCORING_FLAGS.enableCharacterVector = true;
  VECTOR_SCORING_FLAGS.useVectorTeamShapeScore = useVector;
  return evaluateCandidate(SELECTED, variantId, tier, {}, [], {});
}

const selectedChars = SELECTED.map((id) => characterVariants.find((v) => v.variantId === id));
if (selectedChars.some((c) => !c)) {
  console.error("선택 캐릭터 variantId 해석 실패:", SELECTED);
  process.exit(1);
}

const AXES = ["frontline", "damage", "durability", "cc", "support", "tempo"];
const f2 = (n) => (n >= 0 ? " " : "") + n.toFixed(2);

console.log(`# teamShapeScore 영향 비교  scenario=[${SELECTED.join(", ")}]  tier=${tier}`);
console.log(`# core 미지정(특성 미선택, cores={}) 기준 — snapshot 과 동일 베이시스\n`);

const rows = [];
for (const [label, charKey, weaponKw] of TARGETS) {
  const variant = resolve(charKey, weaponKw);
  if (!variant) { console.log(`${label.padEnd(16)} : 해석 실패 (변종 없음)`); continue; }

  const legacy = evalWith(false, variant.variantId);
  const vector = evalWith(true, variant.variantId);
  const team = [...selectedChars, variant];
  const tv = teamVector(team, {}, tier).sum;

  rows.push({ label, variantId: variant.variantId, baseRole: variant.role, legacy, vector, tv });
}

// 정렬: vector total 내림차순 (vector 추천 순위 관점)
rows.sort((a, b) => b.vector.total - a.vector.total);

const head = [
  "candidate".padEnd(16), "variantId".padEnd(20), "role".padEnd(9),
  "legTotal", "vecTotal", "Δtotal", "legShape", "vecShape", "Δshape",
].join("  ");
console.log(head);
console.log("-".repeat(head.length));
for (const r of rows) {
  const lt = r.legacy.total, vt = r.vector.total;
  const ls = r.legacy.scores.teamShape, vs = r.vector.scores.teamShape;
  console.log([
    r.label.padEnd(16),
    r.variantId.padEnd(20),
    r.baseRole.padEnd(9),
    f2(lt), f2(vt), f2(vt - lt),
    f2(ls), f2(vs), f2(vs - ls),
  ].join("  "));
}

console.log("\n# teamVector sum (frontline, damage, durability, cc, support, tempo)");
for (const r of rows) {
  console.log(`${r.label.padEnd(16)} ` + AXES.map((a) => `${a[0]}${a === "durability" ? "u" : ""}:${r.tv[a].toFixed(2)}`).join("  "));
}

console.log("\n# 참고: Δtotal 은 전적으로 Δshape 에서 옴 (다른 점수 항은 플래그와 무관, 동일).");
