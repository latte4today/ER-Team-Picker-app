# 추천 엔진 검증 브리프

## 0.3.4 결론

0.3.4에서는 기존 `total` 점수 경로를 보존한 채 `useLeanScoring` 경로를 기본값으로 전환했다. 목표는 12개 휴리스틱 합이 공식 통계 신호를 덮지 않도록 하고, 검증된 캐릭터/무기 강함을 지배 항으로 둔 뒤 조합 보정은 제한된 범위에서만 순위를 밀게 만드는 것이다.

## 점수 구조

`leanTotal`은 다음 신호를 합산한다.

- 공식 통계 기반 `strengthScore`: 후보의 top3율, 승률, 평균 등수를 티어 평균과 비교한다.
- `pairSynergyTerm`: 유의한 공식 페어 lift만 작게 반영한다.
- `fitTerm`: 역할 보완, 전열/후열 화력, 팀 화력 예산, 충돌, 조합 가이드를 별도 bounded 보정으로 둔다.
- `heuristicTerm`: 기존 휴리스틱 일부를 작은 cap 안에서만 반영한다.
- 사용자 관계/피드백 신호와 난이도 보정을 유지한다.

기존 legacy total은 코드에 남아 있으며 `VECTOR_SCORING_FLAGS.useLeanScoring`을 끄면 롤백할 수 있다.

## 검증 결과 요약

공식 매치 데이터 `matches-current-20260617T051948Z.jsonl`에서 lobby concordance를 seed 1~3으로 확인했다.

| seed | shipped | lean | control |
|---|---:|---:|---:|
| 1 | 0.501 | 0.516 | 0.533 |
| 2 | 0.508 | 0.527 | 0.539 |
| 3 | 0.503 | 0.525 | 0.538 |

해석:

- `lean`은 모든 seed에서 `shipped`보다 높다.
- `control`에는 대체로 근접하지만, 역할 보완을 살리기 위해 strength-only 수준까지 완전히 붙이지는 않았다.
- demigod/eternity 구간에서도 `lean`은 `shipped`보다 개선된다. 다만 seed별 표본 변동이 있어 control을 항상 넘는다고 보지는 않는다.

## Face-Validity 게이트

다음 항목을 확인했다.

- 역할 보완: 전열이 필요한 조합에서 쇼우, 에스텔, 레온, 알렉스 같은 전열/브루저 후보가 남는다.
- 다양성: Top12에서 한 archetype이 과점하지 않도록 diversity 후처리가 작동한다.
- variant 중복: Top12 내 동일 variant 과점을 막는 soft cap을 추가했다.
- 안티시너지: `kenneth|markus` 같은 유의한 음수 pair lift가 상위 추천을 억지로 밀어올리지 않는다.
- 설명 문구: 추천 상위권 후보가 첫 문장부터 경고로 시작하지 않도록 긍정/보완 설명을 먼저 노출한다.

## 재현 명령

```powershell
& 'C:\Program Files\nodejs\node.exe' tools\backtest_recommender.mjs --data 'C:\Users\WIN11\Desktop\ER\collected-official-data\data\ml-training\matches-current-20260617T051948Z.jsonl' --metric concordance --games 800 --scan 110000 --configs shipped,lean --seed 1
& 'C:\Program Files\nodejs\node.exe' tools\backtest_recommender.mjs --data 'C:\Users\WIN11\Desktop\ER\collected-official-data\data\ml-training\matches-current-20260617T051948Z.jsonl' --metric concordance --games 800 --scan 110000 --configs shipped,lean --seed 2
& 'C:\Program Files\nodejs\node.exe' tools\backtest_recommender.mjs --data 'C:\Users\WIN11\Desktop\ER\collected-official-data\data\ml-training\matches-current-20260617T051948Z.jsonl' --metric concordance --games 800 --scan 110000 --configs shipped,lean --seed 3
& 'C:\Program Files\nodejs\node.exe' tools\archetype_distribution.mjs --top 12
& 'C:\Program Files\nodejs\node.exe' tools\snapshot_recommendations.mjs
```
