# 연속화 1단계 설계 — characterVector / teamVector

목표: 이산 `character.role` + 부울 술어 더미를 6축 연속 벡터로 표현하고, 기존
`isTank`/`teamShape` 등은 벡터 위 **얇은 래퍼**로 호환 유지하면서 점수 함수를
하나씩 연속값으로 이전한다. 표시 role 라벨은 벡터에서 파생한다.

핵심 원칙: 이번 단계는 **재설계가 아니라 표현 계층 추가**다. 이미 검증·하드닝된
`inferredCoreRoleOverride` / `applyCoreRoleProfile`를 재활용하고, 그 위에 벡터를
얹는다. 즉 벡터는 effective 캐릭터를 *읽어* 만든다(override 로직을 재구현하지 않는다).

---

## 0. 현재 구조 (착수 전 기준선)

- 역할: `character.role` ∈ {frontline, bruiser, assassin, ranged, mage, support}
- 술어: `isTank`/`isMeleeDealer`/`isBacklineDealer`/`isSupport`/`isReliableDps`/
  `isFrontRole` (모두 `character.role` 기반) + 댐리언 술어(`isHighDamageFront`,
  `isLowDamageBackline` …) + 교전스타일 술어(`isFirstEngageStyle`,
  `isCounterOnlyRanged`, `cannotStartEngage` …)
- 집계: `teamShape(team)` → 카운트 객체
- 이미 연속인 신호:
  - `corePlaystyle(row, tier)` → `{damage, durability, support, cc, tempo}` (코어 태그 코드 기반)
  - `ccPower(character)` → CC 질량 (ccProfile 가중합)
  - `frontDamage`/`backlineDamage` ∈ {low, medium, high}
  - `applyCoreRoleProfile` → effective 캐릭터 (role/tags/damage/frontDamage override)

---

## 1. 벡터 정의

`characterVector(character, core, tier) -> { frontline, damage, durability, cc, support, tempo }`

각 축은 캐릭터당 대략 0..1로 정규화(팀 합산이 0..3 범위에 들도록).

축 의미:
- **frontline**: 구조적 전열성(전방 점유). 코어 무관에 가깝게 역할 기반. 팀의 전/후열
  균형 계산에 쓰임.
- **damage**: 딜 기여(전열/후열 무관 총량).
- **durability**: 생존/탱킹.
- **cc**: 군중제어 (주로 `ccPower` 경험값 + 태그/코어 보정).
- **support**: 힐/실드/피어/유틸.
- **tempo**: 기동/다이브/이니시 속도감.

### 1a. 산출 절차 (effective 캐릭터 기반)

```
const eff = applyCoreRoleProfile(character, core, tier);   // 기존 override 재활용
const seed = ROLE_SEED[eff.role];                          // 역할 시드 벡터
let v = { ...seed };
v.damage      *= DAMAGE_SCALE[eff.frontDamage|backlineDamage];  // 역할 위치에 맞는 축
applyTags(v, eff.tags);                                    // 태그 보정 (가산/감산)
v.cc         = blend(v.cc, ccPower(eff));                   // 경험 CC 질량 우선
blendCore(v, corePlaystyle(coreRowFor(...), tier), W_CORE); // 코어 플레이스타일 혼합
clampAxes(v, 0, 1.25);
```

- override가 이미 role/tags/frontDamage를 코어에 맞게 바꿔두므로, 벡터는 그 결과를
  표현만 하면 된다 → **override 로직 중복·드리프트 위험 없음**.
- `W_CORE` (코어 혼합 가중치, 초기 0.30~0.35): 코어가 같은 캐릭터의 강조점을 옮기되
  역할 시드를 압도하지 않게.

### 1b. ROLE_SEED (초기값, 튜닝 대상)

| role      | frontline | damage | durability | cc   | support | tempo |
|-----------|-----------|--------|------------|------|---------|-------|
| frontline | 1.00      | 0.20   | 0.90       | 0.45 | 0.20    | 0.20  |
| bruiser   | 0.85      | 0.60   | 0.60       | 0.35 | 0.10    | 0.40  |
| assassin  | 0.55      | 0.85   | 0.25       | 0.20 | 0.05    | 0.85  |
| ranged    | 0.15      | 0.85   | 0.20       | 0.20 | 0.10    | 0.30  |
| mage      | 0.15      | 0.80   | 0.20       | 0.50 | 0.15    | 0.30  |
| support   | 0.20      | 0.25   | 0.45       | 0.45 | 0.90    | 0.30  |

`DAMAGE_SCALE`: low=0.65, medium=1.00, high=1.30 (해당 역할 위치의 damage 축에만 적용).

태그 보정(예시): focus/burst→damage+, durable/sustain→durability+,
peel/shield/healing→support+ & durability+, cc/initiate→cc+, mobility→tempo+,
sustained→damage(지속) 소폭+.

### 1c. teamVector

`teamVector(team, cores, tier)` = 멤버 벡터의 **축별 합**(구조 질량) + 필요 시 평균 보관.

```
{ sum: {frontline, damage, ...}, avg: {...}, members: [v0, v1, v2] }
```

- 전/후열 균형, 딜 총량 같은 "질량" 판단엔 `sum`.
- 정규화 비교가 필요한 점수엔 `avg`.

---

## 2. 코어 무관 고정 — 벡터에 넣지 않는 것

다음은 **벡터로 흡수하지 않고 별도 유지**한다 (코어와 독립, 역할/딜과 직교):

- 교전 타이밍: `isFirstEngageStyle`, `isDelayedEngageStyle`, `cannotStartEngage`,
  `isCounterOnlyRanged`, `isPokeThenEngage`, `helpsMeleeEngage`, `likesDiveFollow`,
  `isGuardOnly` …
- 사거리/포지션 식별자.

이유: 이들은 "언제/어떻게 교전을 여는가"의 정체성으로, 코어가 바뀌어도 고정이며
`engagerInLenoxTeam` 류 게이팅의 근거다. 벡터(역할 질량/기능)와 섞으면 이번 세션에
고친 게이팅 회귀 위험. 경계를 명시적으로 분리한다.

---

## 3. 마이그레이션 순서 (스냅샷 사이사이 확인)

각 단계 후 로컬에서 `node tools\snapshot_recommendations.mjs` 실행해 드리프트 감시.
**1·2단계는 diff 0이 목표**(순수 리팩터), 3단계부터 의도적 변화 허용·검토.

1. **벡터 도입(무변화)**: `characterVector`/`teamVector` 추가, 캐시. 아직 아무도 안 씀.
   스냅샷 diff = 0.
2. **술어 래퍼화(무변화)**: `isTank`/`isFrontRole`/`isMeleeDealer`/`isBacklineDealer`/
   `isSupport`를 벡터 임계값으로 재정의하되, **현재 부울 출력을 정확히 재현하는
   임계값** 선택. 스냅샷 diff = 0 확인이 게이트. (재현 안 되는 임계는 시드/스케일
   조정으로 맞춤.)
3. **점수 함수 이전(변화 허용)**: 한 번에 하나씩 연속값 사용으로 전환, 매번 스냅샷 검토.
   순서(벡터 친화도 높은 것부터):
   1. `teamShapeScore`
   2. `roleBalanceScore`
   3. `frontDamageScore` / `backlineDamageScore`
   4. `metricBalanceScore`
   5. `compositionGuideScore` / `dakCompositionScore`
   - `official*`(승률 기반) 계열은 직교하므로 **이전 대상 아님**.
4. **표시 라벨 파생**: `roleLabel`/`teamShapeLabel`을 벡터(argmax/임계)에서 파생.
   라벨 변동은 스냅샷에 잡히므로 별도 검토.

---

## 4. 검증·함정 (인계 메모 반영)

- 검증은 **로컬에서만**. 샌드박스 마운트 사본은 잘려 신뢰 불가 (이번에도
  `recommender.js`가 `if (code ===`에서 절단 확인됨).
- Node 단독 실행 시 `globalThis.localStorage` 셰임 필요(`explain()`의 `t()` 참조).
- 데이터(`officialTraitBuildStats`)는 원격 갱신 → 갱신마다 `auditCoreRoleFlips` 재실행.
- 리팩터 전 기준 스냅샷 저장돼 있음(`snapshots/recommendations.json` 또는
  `__snapshots__/`). 1·2단계는 그에 대해 diff 0.

---

## 5. 합의 필요 항목 (착수 전)

- ROLE_SEED 초기값과 `W_CORE`(코어 혼합 가중치) 수용 여부.
- 술어 임계값을 "현 출력 정확 재현"으로 고정할지, 약간의 의도적 개선을 1·2단계에서
  허용할지.
- teamVector 집계를 sum 중심으로 갈지, sum+avg 동시 보관할지.
