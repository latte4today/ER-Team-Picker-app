# 데이터 파이프라인 개편 — 분업 계획

문제: "원본 매치 누적 + 전체 통계 재생성" 구조라 원본은 선형 증가, 조합/페어 번들은
커버 조합 증가로 빠르게 비대. 동시에 ML용으론 데이터를 다 보관해야 함.

해법(요지): **보존 정책을 둘로 분리.** 추천기는 최근만(작게·신선), ML은 전부(압축·durable·hot path 밖).
세 저장 계층 — ① ML 아카이브(전부 영구·압축·git/CI 밖) ② 증분 요약 카운터(작음) ③ 앱 compact 번들(작음, 파생).

---

## 인터페이스 계약 (양측 합의점, 변경 시 서로 통지)

**compact 번들 스키마** = 큰 `officialMatchStats.json`에서 **코드가 쓰는 스칼라 필드만** 남긴 동일 구조.
- 유지: `officialCandidateStatsByTier`, `officialTraitBuildStatsByTier`, `officialCompositionStatsByTier`,
  `officialPairStatsByTier`, `officialCombatStatsByTier`, `officialTraitStatsByTier`, `weights`, `alpha`.
- 각 엔트리에서 유지하는 스칼라: `core, name, games, winRate, top3Rate, avgPlacement,
  avgDamageToPlayer(+Basic/Skill), avgDamageFromPlayer(+Basic/Skill), avgCcTime, avgCcCount,
  basicDamageShare, skillDamageShare, uniqueSkillDamageShare`.
- **드롭(코드 미사용·용량 대부분):** `firstSubTraits`, `secondSubTraits`, `tacticalSkills` 배열.
- 검증: `src/pairSynergyLift.js`(페어)와 이 compact만으로 추천이 동일해야 함 →
  `tools/snapshot_recommendations.mjs` diff 0.

Other가 ② 증분 요약에서 이 shape로 compact를 뱉으면, 트리머(아래) 없이도 바로 호환된다.

---

## 분업

### A 측 (Claude/나) — 소비 측: recommender · app · compact 포맷
- [x] **A1. compact 스키마 정의 + 트리머** `tools/build_compact_stats.mjs` — 큰 JSON → compact JSON.
      (지금 실행. 코드 미사용 배열만 제거, 추천 결과 불변.)
- [ ] A2. 추천기/앱이 **compact를 로드**(있으면 우선, 없으면 full fallback). 로컬 `node --check`
      + `snapshot_recommendations` diff 0 검증.
- [ ] A3. 추천기 stats에 **rolling window/패치 감쇠** 읽기 옵션(품질·크기). snapshot으로 변화 관찰.
- [ ] A4. 큰 번들/원본 **`.gitignore`** + 앱이 compact(or 원격 STATS_URL) 사용하도록 마무리.

### B 측 (Codex) — 생산 측: collector · archive · summary · infra
- [x] B1. **수집기 → append-only 날짜별 gzip 샤드**(`data/official-archive/matches-YYYY-MM-DD.jsonl.gz`).
      `tools/archive_official_matches.mjs` 추가. 전체 재작성 없이 실행 단위 gzip member를 shard에 append.
- [x] B2. **요약 집계기** `officialMatchSummary.json` — `tools/build_official_summary.mjs` 추가.
      기본 모드는 전체 재생성, `--incremental` 모드는 `summary-state.json`의 shard byte offset 이후 새 gzip member만 fold-in.
- [x] B3. **compact 생성 경로** — `tools/build_compact_stats.mjs`, `tools/build_compact_from_archive.mjs` 추가.
      workflow가 full stats artifact와 함께 배포용 compact artifact를 생성한다.
      `--composition-min-games`, `--drop-composition`, `--pair-min-games`, `--trait-build-min-games`,
      `--candidate-min-games`, `--combat-min-games`, `--round-rates`, `--round-averages` 옵션 준비 완료.
      A 판정 완료값: `--composition-min-games 20 --round-rates 3 --round-averages 2`.
- [~] B4. **인프라:** `src/officialMatchStats.compact.json`을 main에 커밋해 앱의 compact 우선 로드 경로로 제공.
      full JSON(`src/officialMatchStats.json`)은 git 추적 해제 + ignore. ML 아카이브 gzip shard는
      `DATA_REPO_TOKEN` secret이 있을 때 `latte4today/ER-Team-Picker-data`의 `official-archive/`로 append commit.
      CI artifact는 여전히 임시 전달용이며 durable 아카이브가 아니다.

### 경계/주의
- rolling window는 **추천기에만**. ML 아카이브엔 적용 금지(전부 보관).
- CI artifact ≠ ML 아카이브. 아카이브는 durable 저장으로.
- A/B의 접점은 **compact 스키마 하나**. 그 shape만 지키면 양쪽 독립 작업 가능.

---

## 권장 순서
1. A1(트리머, 완료) → 즉시 크기 절감 확인.
2. A2(앱이 compact 로드) + A4(gitignore) → 레포/앱 가벼워짐.
3. B1·B2(append 샤드 + 증분 요약) → 수집/빌드 구조 전환(근본).
4. B3 + A3(rolling window) → 품질·크기 마무리.
