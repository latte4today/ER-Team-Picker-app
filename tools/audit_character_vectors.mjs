/**
 * audit_character_vectors.mjs
 * 연속화 1단계 진단: 특성(코어)에 따라 역할이 달라질 수 있는 캐릭터들의
 * core별 effectiveRole 과 characterVector(6축)을 출력한다.
 *
 * Usage:
 *   node tools/audit_character_vectors.mjs                 # 기본 대상 (루크/매그너스/현우/케네스/쇼우)
 *   node tools/audit_character_vectors.mjs 루크 매그너스    # 이름/variantId 접두로 필터
 *   node tools/audit_character_vectors.mjs --tier diamond  # 티어 지정
 *   node tools/audit_character_vectors.mjs --all           # 역할이 바뀌는 모든 캐릭터
 *
 * 주의: 검증은 로컬에서만. 샌드박스 마운트 사본은 잘려 신뢰할 수 없음.
 */

// Node에는 브라우저 전역이 없으므로 import 전에 셰임 (i18n t()가 참조).
const _store = {};
globalThis.localStorage = {
  getItem:    (k)    => _store[k] ?? null,
  setItem:    (k, v) => { _store[k] = String(v); },
  removeItem: (k)    => { delete _store[k]; },
};
globalThis.document = { documentElement: { lang: "ko" } };

import { auditCharacterVectors, VECTOR_SCORING_FLAGS } from "../src/recommender.js";

const AXES = ["frontline", "damage", "durability", "cc", "support", "tempo"];
const DEFAULT_FILTERS = ["루크", "luke", "매그너스", "magnus", "현우", "hyunwoo", "케네스", "kenneth", "쇼우", "shoichi", "sho"];

const argv = process.argv.slice(2);
let tier = "all";
let onlyRoleChanges = false;
const filters = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--tier") { tier = argv[++i] ?? "all"; continue; }
  if (a === "--all")  { onlyRoleChanges = true; filters.length = 0; continue; }
  filters.push(a);
}

const useFilters = onlyRoleChanges ? [] : (filters.length ? filters : DEFAULT_FILTERS);

const fmtVec = (v) => "{ " + AXES.map((k) => `${k[0]}:${v[k].toFixed(2)}`).join("  ") + " }";

console.log(`# characterVector 진단  (tier=${tier})`);
console.log(`# flags: ${JSON.stringify(VECTOR_SCORING_FLAGS)}`);
console.log(`# 축: f=frontline d=damage du=durability(2nd letter) c=cc s=support t=tempo`);
console.log("");

let report = auditCharacterVectors(useFilters, tier);

if (onlyRoleChanges) {
  report = report
    .map((c) => ({ ...c, cores: c.cores.filter((x) => x.roleChanged) }))
    .filter((c) => c.cores.length > 0);
}

if (report.length === 0) {
  console.log("매칭되는 캐릭터가 없습니다. 필터를 확인하세요:", useFilters);
  process.exit(0);
}

for (const ch of report) {
  console.log(`■ ${ch.name}  [${ch.variantId}]  baseRole=${ch.baseRole}  (${ch.cores.length} cores)`);
  for (const c of ch.cores) {
    const flip = c.roleChanged ? `  ⮕ ${ch.baseRole}→${c.effectiveRole}` : "";
    const dmg = `fd=${c.frontDamage ?? "-"} bd=${c.backlineDamage ?? "-"}`;
    console.log(`   - ${String(c.core).padEnd(14)} role=${c.effectiveRole.padEnd(9)} ${dmg.padEnd(18)} ${fmtVec(c.vector)}${flip}`);
  }
  console.log("");
}

const flips = report.flatMap((c) => c.cores.filter((x) => x.roleChanged).map((x) => `${c.name}/${x.core}: ${c.baseRole}→${x.effectiveRole}`));
console.log(`요약: 출력 ${report.length}개 캐릭터, role 변경 ${flips.length}건.`);
for (const f of flips) console.log(`  • ${f}`);
