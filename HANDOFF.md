# ER Team Picker — 작업 인계 (HANDOFF)

다른 세션에 그대로 붙여넣어 이어서 진행하기 위한 정리.

## 0. 환경 / 주의사항 (먼저 읽기)
- 프로젝트: 이터널리턴 조합 추천 앱. **웹(Vercel) + Electron 데스크톱** 동시 배포. 5개 언어(ko/en/ja/zhHans/zhHant).
- 작업 폴더: `C:\Users\WIN11\Documents\Codex\2026-05-31\https-dak-gg-er-https-dak`
- **★ 파일 동기화 함정 (중요):** AI 샌드박스 bash로 쓰거나 복사한 파일은 **Windows 폴더로 동기화되지 않음**. 파일 편집 도구(Edit/Write) 수정은 동기화됨.
  - 따라서 바이너리/이미지는 **로컬에서 스크립트로** 가져와야 함.
  - 샌드박스의 `node --check` / JSON 파싱은 마운트 사본이 깨져 있어 **신뢰 불가** → **검증은 로컬에서** (`node --check src\app.js`).
  - `officialMatchStats.json` 등 데이터 파일은 **로컬이 정답**.
- 앱은 시작 시 GitHub raw의 `src/officialMatchStats.json`을 fetch해 번들 데이터를 덮어씀 → 통계/특성은 **워크플로가 커밋한 원격 데이터**가 실제 반영(웹 재배포 불필요). 데스크톱 코드 변경만 `npm run installer-win` 필요.

## 1. 지금 가장 시급한 활성 문제 — 특성 코드↔이름 + 데이터 버그

### 증상
루크/니아/이안 등 일부 캐릭터가 **실제 메타와 다른 주특성**으로 표시됨.

### 진단 (확정)
1. **이름 매핑 깨짐**: `build_official_stats`가 특성 코드→이름을 못 만듦.
   - `/v1/data/Trait` 는 200인데 **이름이 없음(코드만)**. 이름은 **l10n(현지화) 파일**에 있음.
   - `/v1/data/TraitCombat`, `/TraitSupport` 는 **502**.
   - 그래서 build가 `currentTraitNameFromSort` **휴리스틱**으로 폴백 → 현재 시즌과 어긋나 오기 발생.
   - 확정 오기: build가 `7300301`을 '벽력'이라 했지만 **실제 와류**.
2. **데이터(코드 기록) 버그 — 이름과 별개, 확정**:
   - `7100501`이 **미르카(실제 치유드론 70%)와 슈린(실제 흡혈마 85%)** 둘 다의 1순위 코드.
   - 한 코드가 두 특성일 수 없음 → 일부 캐릭터의 **기록된 traitFirstCore가 실제와 불일치**.
   - 아비게일/수아는 정상(7300301=와류). **선택적 오류**(신규 캐릭터=코드 88/86/83 에서 발생 추정).

### 확정 매핑 (검증표 시작)
| 코드 | 진짜 이름 | 근거 |
|---|---|---|
| 7000501 | 벽력 | 사용자 확인 |
| 7300301 | 와류 | 아비게일 97.7% · 수아 93% 와류 (build는 '벽력'로 오기) |

### 사용자 ground truth (실제 메타)
- 미르카: 치유드론 ~70%, 와류 ~20%
- 슈린: 흡혈마 ~85%
- 비형: 응징 ~78%, 와류 ~11%
- 아비게일 와류 97.7% / 수아 와류 93%

### diag_cores.mjs 출력 (로컬, generatedAt 2026-06-16, 27417팀, 16 codes)
형식: `코드 | build이름(휴리스틱,의심) | 최다사용 캐릭터`
```
7000401 흡혈마  yumin, debi_marlene, hisui
7000601 아드레날린  katja, rio, tsubame
7000501 벽력(확정)  haze, lenore, barbara
7100501 (build:응징)  mirka, shirin, isaac      ← 데이터 의심(미르카=치유드론,슈린=흡혈마)
7100101 금강  yuki, magnus, nicky
7200301 치유드론  garnet, estelle, fenrir
7300301 와류(확정, build오기:벽력)  abigail, sua, ian
7200201 증폭드론  bianca, hyejin, ian
7300101 스텔라차지  darko, irem, alex
7200501 (build:헌신)  bihyung, leni, lenox       ← 비형 실제=응징
7300201 도깨비불  henry, adina, justina
7000201 취약  alonso, hart, shirin
7100201 불괴  camilo, cathy, elena
7100401 빛의수호  tia, bernice, nathapon
7000701 액셀러레이터  leon, martina, magnus
7200101 초재생  charlotte, johann, leon
```

### 다음 단계 (정확한 순서)
1. **`node tools/probe_trait_l10n.mjs` 실행** (로컬). → `/v1/data/Trait` 구조 + `/v1/l10n/Korean` 파일에서 "와류"/"7300301" 검색해 **이름 키 형식** 파악, `data/l10n-ko.txt` 저장.
   - `[contains "7300301"]`에 "와류"가 함께 나오면 → **l10n 키 = 코드**. l10n 하나로 전체 code→name 확정 가능 + `7100501`의 진짜 이름 확인.
2. **이름 수정**: `build_official_stats.mjs`의 `buildTraitNameMap`을 **l10n 기반**으로 교체(휴리스틱 `currentTraitNameFromSort` 폐기). 또는 검증된 code→name 표 하드코딩.
3. **데이터 버그 조사**: 7100501이 단일 이름인데 미르카·슈린 둘 다면 → 원시 매치 데이터의 `traitFirstCore`가 일부 캐릭터에서 잘못 기록됨. `data/official-cache`의 게임 JSON에서 슈린/미르카 플레이어 raw `traitFirstCore` 확인 → 수집 단계 `official_collect_utils.mjs`의 `traitInfoOf` 또는 캐릭터 매핑 점검.
4. **재빌드 + 커밋**: 수정 후 `node tools/build_official_stats.mjs --in data/ml-training/corpus.jsonl` 재실행 → `src/officialMatchStats.js/.json` 커밋 → 원격 반영.

### 만든 진단 스크립트 (tools/)
- `diag_cores.mjs` — 코드→top캐릭터 표 (실행 완료).
- `fetch_trait_table.mjs` — /data/Trait에서 이름 시도 → **0 rows + 502 확인**(이름 없음).
- `probe_trait_l10n.mjs` — **다음 실행할 것**. l10n 이름 키 형식 파악.
- `import_trait_images.mjs` — 특성 아이콘 로컬 복사(완료).

## 2. 이번 세션에 완료/구현된 것 (대부분 커밋됨 — git 상태 확인 권장)

### A. Supabase / 피드백
- 투표 중복 제한 4시간 → **1시간** (`feedback.js`, `supabaseFeedback.js`).
- **모든 투표 시도 로그** 테이블 `recommendation_vote_events`(append-only) + **30일 TTL(pg_cron)**. `supabase/schema.sql` + 클라이언트 fire-and-forget insert. (Supabase에 SQL 적용 완료)

### B. 데이터 수집 (tools/, .github/workflows/collect-seeds.yml)
- 닉네임 시드는 next-seeds 없을 때만 fallback.
- **시드 드리프트 수정**: next-seed를 실제 측정 티어로 분류 (`official_seed_collector.mjs`).
- **롤링 시드 풀**: 티어당 50 저장 / 15 사용.
- **리더보드 시딩**: `/v1/rank/top` 상위 100명을 demigod_eternity에 주입.
- **티어 분류 순위 기반**: 상위 300=eternity, 1000=demigod (`official_collect_utils.mjs` `extractRankInfo`, mmr 6000 floor 가드).
- `merge_match_input.mjs`: 누적 **20만 상한 + compact** 저장 (JSON 문자열 한계 회피).
- **ML 코퍼스**: append-only JSONL 무제한 누적 (`tools/append_ml_corpus.mjs`, `data/ml-training/corpus.jsonl`, 캐시+아티팩트).
- `build_official_stats.mjs`: **코퍼스(JSONL) 스트리밍 읽기** → 통계가 무제한 코퍼스 기반(표본 수 계속 증가). 입력 `--in data/ml-training/corpus.jsonl`.
- 워크플로 커밋 단계: `git rebase -X theirs` + 재시도 (생성파일 충돌 해결).

### C. 후원 기능
- 사이드바 "후원하기" → 모달: **NaverPay/Toss QR + Ko-fi** (사용자가 배너 방식 재설계: `support-banner-naver/toss/kofi`).
- Ko-fi: `ko-fi.com/U1P821E45U`. QR: `assets/support-qr-naver.png`, `support-qr-toss.png`(네이버 QR 정사각 크롭됨).
- ER API 약관: 개인 수익화 연 2천만원까지 허용, 게임정보 유료화 금지 → 광고/기부 OK.

### D. 모바일 UI
- 티어 선택 → **설정 모달**로 이동(모바일 상단바 티어 숨김, `settings-tier-select` 동기화).
- 하단 바: 탭/유니온 + **더보기 메뉴**(설정/후원/문의 팝업).
- 캐시버스트 `styles.css?v=0.3.4`, `app.js?v=0.3.4`.
- 픽한 팀(하단): 팀원 있으면 팀원만, 나 혼자면 내 픽만 표시.

### E. 특성(주특성) 기능 — 진행 중
- 앱이 `officialTraitBuildStatsByTier` import + 원격 갱신 연동.
- 헬퍼 `topCoresForVariant` / `defaultCoreForVariant` (캐릭터별 상위 core, minGames+8% 임계). 112 variant 중 ~62 단일/~50 복수.
- 픽 슬롯 **특성 아이콘 선택 UI**: `coreButtonsForSlot`, `selectSlotCoreButton`, `slotCores` 상태.
- 추천 카드에 추천 특성 표시: `traitChip`.
- 특성 이미지: `assets/traits/*.png`(16 core). `TRAIT_IMAGE`(한글이름→슬러그) — 이름 맞으면 이미지 정상.
- `recommender.js`: `officialCore` 점수 + `cores` 맵 배선(evaluateCandidate/recommend에 cores 파라미터, app이 `selectedCoresMap()` 전달). 사용자/Codex가 `officialCoreFit`, `officialCoreRoleShift`도 추가했다고 언급.
- **특성 4단계 계획**: 1.per-core 성능 반영 2.core별 역할/딜/생존/CC 보정 3.표본 충분한 페어/조합만 core-synergy 4.ML에 core feature. → 현재 1 일부 + 배선만, 2~4 미완. (단 위 "코드↔이름/데이터 버그"부터 잡아야 의미 있음)

## 3. 기타 미해결
- **무기 코드 예외**: sho 15=단검/19=창 override 넣음. 무기 여러 개인 캐릭터 전수 검증 필요(`statIdForPlayer`/`inferOfficialWeaponMap`).
- **특성 추천 UI 보강**: "현재 조합 진단"에 특성 보완/충돌/선택 기준 표시 미흡.
- **특성 이름 다국어**: 현재 한국어 고정(데이터가 한글 이름). 다국어는 별도 사전 필요.
- **app.js 문법**: 로컬에서 `node --check src\app.js` 확인(샌드박스 불가).
