/**
 * classify_vector_diff.mjs
 * full-vector 실험의 추천 변화를 "조합 형태"가 아니라 "승리 플랜/축" 관점에서 4분류한다.
 *
 *   1) legacy가 과하게 감점한 비정형 조합을 vector가 살려낸 경우
 *   2) 실제로 좋은 조합인데 vector가 더 잘 평가한 경우
 *   3) 실제로 애매한 조합인데 vector가 과하게 올린 경우
 *   4) 특정 축 보너스가 중복되어 과하게 오른 경우
 *
 * 비정형(3근/3원/2근+서폿/무탱)을 형태만으로 나쁘게 보지 않는다 — teamVector 축 합과
 * 함수별 기여를 보고 분류한다. blend/스코어는 수정하지 않는다(관찰 전용).
 *
 * Usage:
 *   node tools/classify_vector_diff.mjs
 *   node tools/classify_vector_diff.mjs --top 12 --move 2
 *
 * 주의: 로컬에서만 실행. 샌드박스 마운트 사본은 잘려 신뢰 불가.
 */

const _store = {};
globalThis.localStorage = { getItem:(k)=>_store[k]??null, setItem:(k,v)=>{_store[k]=String(v);}, removeItem:(k)=>{delete _store[k];} };
globalThis.document = { documentElement: { lang: "ko" } };

import { recommend, evaluateCandidate, teamVector, characterVector, VECTOR_SCORING_FLAGS } from "../src/recommender.js";
import { characterVariants } from "../src/data.js";

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const TIER = opt("--tier", "all");
const TOPN = Number(opt("--top", 12));
const MOVE = Number(opt("--move", 2)); // 이만큼 이상 순위 상승한 후보만 분석

const SCENARIOS = [
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

const AXES = ["frontline", "damage", "durability", "cc", "support", "tempo"];
const SCORE_KEYS = ["roleBalance", "frontDamage", "backlineDamage", "teamShape", "metricBalance", "compositionGuide"];

function setVector(on) { VECTOR_SCORING_FLAGS.enableCharacterVector = on; }
function charOf(id) { return characterVariants.find((v) => v.variantId === id); }

function topList(selected) {
  return recommend(selected, TIER, {}).slice(0, TOPN).map((r, i) => ({
    rank: i + 1, id: r.character.variantId, total: r.total, core: r.recommendedCore?.name ?? null,
  }));
}

function dominantAxis(vec) {
  // frontline 은 위치축이라 기능축(damage/durability/cc/support/tempo) 중 최대를 본다
  const fns = ["damage", "durability", "cc", "support", "tempo"];
  return fns.reduce((a, b) => (vec[b] > vec[a] ? b : a), "damage");
}

function classify({ legScores, vecScores, deltas, tvSum, cand, netDelta }) {
  const reasons = [];
  // legacy가 강하게 감점했는가
  const legNeg = (legScores.teamShape ?? 0) + (legScores.compositionGuide ?? 0) + Math.min(0, legScores.metricBalance ?? 0);
  const legHeavyPenalty = (legScores.teamShape ?? 0) <= -1.5 || (legScores.compositionGuide ?? 0) <= -1.2 || legNeg <= -2.5;

  // damage 축에 묶인 양수 기여 개수 (중복 보너스 탐지)
  const dmgDriven = ["roleBalance", "frontDamage", "backlineDamage", "teamShape", "metricBalance"]
    .filter((k) => (deltas[k] ?? 0) > 0.03).length;
  const candAxis = dominantAxis(characterVector(cand, undefined, TIER));

  // 결과 팀의 실제 결핍 (형태가 아니라 축 기준)
  const deficient =
    tvSum.damage < 1.4 ? "damage" :
    (tvSum.durability < 0.9 && tvSum.cc < 1.0) ? "durability+cc" :
    tvSum.cc < 0.7 ? "cc" : null;

  let cat;
  if (legHeavyPenalty && netDelta > 0.15) {
    cat = 1; reasons.push(`legacy 강패널티(teamShape=${(legScores.teamShape ?? 0).toFixed(2)}, comp=${(legScores.compositionGuide ?? 0).toFixed(2)}) → vector가 구제`);
  } else if (netDelta > 0.15 && deficient) {
    cat = 3; reasons.push(`결과 팀 축 결핍(${deficient}) 있는데 +${netDelta.toFixed(2)} 상승 — 과평가 의심`);
  } else if (netDelta > 0.15 && dmgDriven >= 3 && candAxis === "damage") {
    cat = 4; reasons.push(`damage 축이 ${dmgDriven}개 함수에서 동시 가점(중복 보너스)`);
  } else if (netDelta > 0.05) {
    cat = 2; reasons.push(`결핍 축 보강(후보 주축=${candAxis}), 결과 팀 결핍 없음 — 적정 상향`);
  } else {
    cat = 0; reasons.push("유의미한 상승 없음");
  }
  // 중복 보너스는 1/2와 겹칠 수 있으니 부가 표시
  if (cat !== 4 && netDelta > 0.15 && dmgDriven >= 3 && candAxis === "damage") reasons.push("※ damage 축 중복 가점 동반(cat4 성격 일부)");
  return { cat, candAxis, dmgDriven, deficient, reasons };
}

function breakdown(selected, candId) {
  setVector(false);
  const leg = evaluateCandidate(selected, candId, TIER, {}, [], {});
  setVector(true);
  const vec = evaluateCandidate(selected, candId, TIER, {}, [], {});
  const deltas = {};
  for (const k of SCORE_KEYS) deltas[k] = (vec.scores[k] ?? 0) - (leg.scores[k] ?? 0);
  return { leg, vec, deltas };
}

const CAT_LABEL = {
  0: "—(변화미미)",
  1: "①legacy과소평가→vector구제",
  2: "②좋은조합 vector가더잘평가",
  3: "③애매한데 과대상향(주의)",
  4: "④축보너스 중복상향(주의)",
};

console.log(`# full-vector diff 분류  tier=${TIER}  top=${TOPN}  (순위 +${MOVE}↑ 또는 신규진입 분석)\n`);

for (const sel of SCENARIOS) {
  const selChars = sel.map(charOf);
  if (selChars.some((c) => !c)) { console.log(`! 시나리오 해석 실패: ${sel.join(", ")}`); continue; }
  setVector(false); const leg = topList(sel);
  setVector(true);  const vec = topList(sel);
  const legRank = new Map(leg.map((x) => [x.id, x.rank]));

  // 분석 대상: vector top 에서 +MOVE 이상 상승했거나 신규 진입
  const movers = vec.filter((x) => {
    const lr = legRank.get(x.id);
    return lr === undefined || lr - x.rank >= MOVE;
  });

  console.log(`■ [${sel.join(", ")}]  base roles: ${selChars.map((c) => c.role).join("+")}`);
  if (movers.length === 0) { console.log("   (상승 무버 없음)\n"); continue; }

  for (const m of movers) {
    const { leg: lb, vec: vb, deltas } = breakdown(sel, m.id);
    const tvSum = teamVector([...selChars, charOf(m.id)], {}, TIER).sum;
    const netDelta = vb.total - lb.total;
    const cls = classify({ legScores: lb.scores, vecScores: vb.scores, deltas, tvSum, cand: charOf(m.id), netDelta });
    const lr = legRank.get(m.id);
    const rankStr = lr === undefined ? `신규→#${m.rank}` : `#${lr}→#${m.rank}`;
    console.log(`   ${CAT_LABEL[cls.cat]}  ${m.id.padEnd(20)} ${rankStr.padEnd(11)} Δtotal=${netDelta >= 0 ? "+" : ""}${netDelta.toFixed(2)}`);
    console.log(`       Δfn: ` + SCORE_KEYS.map((k) => `${k}=${deltas[k] >= 0 ? "+" : ""}${deltas[k].toFixed(2)}`).join("  "));
    console.log(`       tvSum: ` + AXES.map((a) => `${a[0]}${a === "durability" ? "u" : ""}:${tvSum[a].toFixed(2)}`).join("  "));
    console.log(`       why: ${cls.reasons.join(" / ")}`);
  }
  console.log("");
}

console.log("범례: ①②는 바람직(legacy 과소평가 교정/정당 상향), ③④는 검토 필요(과평가/중복).");
console.log("분류는 휴리스틱 1차안 — 최종 판단은 실제 게임 감각으로 보정하세요.");
