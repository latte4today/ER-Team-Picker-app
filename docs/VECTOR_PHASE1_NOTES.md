# 연속화 1단계 — 구현 노트 (이번 세션)

표현 계층만 추가하고 teamShapeScore 하나만 플래그로 실험 연결. 술어/다른 점수 함수는
손대지 않음.

## 변경 사항 (`src/recommender.js`)

- `VECTOR_SCORING_FLAGS` 추가:
  - `enableCharacterVector: true`, `useVectorTeamShapeScore: true`
  - `useVectorRoleBalanceScore / useVectorDamageBalanceScore / useVectorMetricBalanceScore /
    useVectorCompositionGuideScore / replaceBooleanPredicates: false`
- `characterVector(character, core, tier)` — 공개. 내부에서 `applyCoreRoleProfile`로 effective
  캐릭터를 만든 뒤 `characterVectorFromEffective`로 6축 매핑. **override 로직 재구현 없음.**
- `characterVectorFromEffective(eff)` — 순수 매핑. `ROLE_SEED_VECTORS[role]` 시드 +
  `DAMAGE_BUCKET_SCALE[front/backDamage]` + `TAG_VECTOR_MODS[tags]` + `ccPower(eff)` +
  `eff.effectiveCore.profile`(= corePlaystyle, 가중치 `VECTOR_CORE_BLEND=0.30`) 혼합. 축 0..1.3 클램프.
- 축: `frontline, damage, durability, cc, support, tempo`.
- `teamVector(team, coreMap, tier)` — 공개. 멤버 `characterVector` 집계 → `{ sum, avg, max, members }`.
- `teamVectorFromEffective(effTeam)` — 점수 함수 내부용(재적용 회피).
- `teamShapeScore` → **디스패처**로 교체: 플래그 ON이면 `vectorTeamShapeScore`, 아니면
  `legacyTeamShapeScore`(기존 본문 그대로 보존).
- `vectorTeamShapeScore(candidate, selected)` — legacy 의도를 연속 질량으로 근사, 출력 [-5.4, 3.0].
- `auditCharacterVectors(filters, tier)` 공개 — 진단용.

호출부(`evaluateCandidate`의 `scores.teamShape`)는 시그니처 동일이라 **무수정**.

## 진단 스크립트

`tools/audit_character_vectors.mjs` — 특성에 따라 역할이 달라지는 캐릭터의 core별
effectiveRole + 벡터 출력.

```
node tools/audit_character_vectors.mjs                # 루크/매그너스/현우/케네스/쇼우
node tools/audit_character_vectors.mjs 루크 매그너스   # 필터
node tools/audit_character_vectors.mjs --all          # role이 바뀌는 모든 캐릭터
node tools/audit_character_vectors.mjs --tier diamond
```

## 스냅샷 비교 (로컬에서 실행 — 샌드박스 마운트는 잘려 실행 불가)

`tools/snapshot_recommendations.mjs`는 `cores={}`로 7개 시나리오의 Top12를 비교한다.
플래그로 before/after를 git 없이 잡을 수 있다:

```
# 1) legacy 기준선
#    src/recommender.js 에서 useVectorTeamShapeScore: false 로 잠시 변경 후
node tools/snapshot_recommendations.mjs --update
#    (다시 true 로 되돌림)

# 2) vector 적용 후 diff
node tools/snapshot_recommendations.mjs
```

### 변화 범위 — 코드 기반 보장

`teamShapeScore`는 **팀 3명 미만이면 legacy·vector 모두 0**을 반환한다
(`if (team.length < 3) return 0;`). 스냅샷 시나리오 중:

- `[]`, `[lenox:whip]`, `[luke:bat]`, `[nia:pistol]`, `[rio:bow]` → 후보 합쳐 팀 ≤2 →
  teamShape 항이 양쪽 다 0 → **Top1/Top3/Top10 변화 0 보장**.
- `[lenox:whip, rio:bow]`, `[luke:bat, nia:pistol]` → 후보 합쳐 팀 3 → vector 경로 작동 →
  teamShape 항만 바뀜 → **이 두 시나리오에서만** 순위 변동 가능.

total 가중치에서 teamShape는 1.0이고 다른 항(synergy 1.6×, meta, official 등)이 함께 작용하므로,
Top1은 비교적 안정적이고 중위권(Top3~Top10) shuffle 가능성이 더 크다. 정확한 변동은 로컬 실행으로
확인.

## 검증 메모

- 샌드박스 마운트는 `recommender.js`/`package.json`/`officialMatchStats.js`가 잘려 node 실행 불가
  → 모든 실행 검증은 로컬에서.
- 벡터 산식 자체는 독립 셀프테스트로 실행 검증함(역할별 단일 벡터·팀 합·teamShape 점수가
  의도대로 동작: 밸런스 조합 +2.1, 3탱 저댐 -3.0, 탱+서폿 딜부족 -1.3 등).
- Node 단독 실행 시 `globalThis.localStorage` 셰임 필요(스크립트에 포함됨).
