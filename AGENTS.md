# ER Team Picker 작업 안내

## 프로젝트 개요

- 이 프로젝트는 이터널 리턴 스쿼드 조합 추천용 Windows/Electron 데스크톱 앱이다.
- 사용자는 팀원 2명과 본인 픽을 캐릭터+무기 단위로 입력하고, 추천 후보와 경기 후 평가를 확인한다.
- 추천 로직은 정적 실험체 데이터, DAK.GG 기반 메타 데이터, 대회 조합 데이터, 사용자 피드백, Supabase 집계 데이터를 함께 사용한다.
- 화면 인식 관련 파일은 남아 있지만 현재 공개 앱의 핵심 흐름은 수동 입력과 추천/평가 중심이다.

## 실제 주요 파일 구조

```text
index.html
  앱 UI 마크업. 사이드 탭, 조합 구성, 랭킹, 유니온, 문의 모달을 포함한다.

src/
  app.js
    메인 렌더러 로직. 탭 전환, 실험체 선택, 추천 카드, 경기 평가, 유니온 UI,
    가능 실험체 프리셋, 문의, 업데이트 상태 표시를 담당한다.
  styles.css
    전체 앱 스타일. 다크/라이트 테마, 카드, 스크롤, 추천/유니온 레이아웃 포함.
  data.js
    실험체 88명과 캐릭터+무기 variant, 역할군, 태그, 무기 정보, 일부 평균 딜량 데이터.
  recommender.js
    추천 점수 계산 핵심. evaluateCandidate(), recommend()를 제공한다.
  combatProfiles.js
    선진입, 후진입, 받아치기, 원딜 진입 보조 등 교전 성향 분류.
  characterMetrics.js
    난이도/피해/방어/군중제어/이동/보조 지표 기반 팀 프로필 계산.
  wikiMetrics.js
    수동 입력된 나무위키식 실험체 지표 데이터.
  tournamentMeta.js
    최근 대회 조합과 결과 기반 보정 데이터.
  metaData.js
    DAK.GG 랭커/통계 기반 메타 데이터. 크기가 큰 자동 생성 성격의 파일이다.
  feedback.js
    로컬 피드백 저장, 4시간 투표 제한 bucket, 서버 재전송 큐 관리.
  supabaseFeedback.js
    Supabase 익명 로그인, 추천 평가 저장/조회, 문의 저장/전송.
  supabaseConfig.js
    Supabase URL과 anon public key. service role key를 넣으면 안 된다.
  koreanSearch.js
    한글 초성 검색. 겹자음 입력 보정도 이쪽을 우선 확인한다.
  unionWorker.js
    유니온 조합 계산 Web Worker. 메인 스레드 버벅임을 줄이기 위한 파일.
  detector.js
    스크린샷 기반 하단 슬롯 감지 로직. 현재는 공개 핵심 기능에서 빠져 있음.
  skinTemplates.js
    추후 스킨 이미지 템플릿용 자리.
  weaponTemplates.js
    무기 아이콘 템플릿 경로.
  updateConfig.js
    앱 버전과 GitHub Releases 업데이트 확인 설정.

electron/
  main.cjs
    Electron 메인 프로세스. 로컬 정적 서버, BrowserWindow, 자동 업데이트,
    외부 링크 열기, 화면 캡처 권한을 담당한다.
  preload.cjs
    contextBridge로 렌더러에 자동 업데이트 API를 노출한다.

assets/
  app-icon.png, app-icon.ico, app-icon.svg
  characters/mini/*.png
    실험체 mini 이미지.
  weapons/*.png
    무기 아이콘.

tools/
  dak_collector.mjs
    DAK.GG 랭커/전적 데이터 수집 및 src/metaData.js 생성.
  make_wiki_metrics_template.mjs
    위키 지표 입력용 템플릿 생성.
  apply_wiki_metrics_csv.mjs
    수동 작성한 위키 지표 CSV를 src/wikiMetrics.js에 반영.
  namu_metrics_collector.mjs
    나무위키 자동 수집 실험용. 느리거나 실패할 수 있으므로 현재는 신뢰하지 않는다.
  collector.py
    보조 수집 스크립트.

supabase/
  schema.sql
    recommendation_votes, recommendation_feedback_summary, contact_messages,
    RLS policy, index, grant 정의.
  functions/contact-notify/index.ts
    Supabase Edge Function 문의 메일 전송. Resend secret을 사용한다.

docs/
  screen-detection-notes.md
    화면 인식 기능을 나중에 다시 붙일 때 참고할 비공개용 설계 노트.

installer/
  ERTeamPicker.iss
    예전 Inno Setup 스크립트. 현재 package.json의 주 빌드 흐름은 NSIS다.
```

## 실행과 빌드

- 개발 실행:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run app
```

- 의존성 설치:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' install
```

- NSIS 설치 파일 생성:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run installer-win
```

- 패키지 폴더만 생성:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run package-win
```

- DAK.GG 데이터 갱신:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run collect-dak
```

- 위키 지표 템플릿 생성 및 반영:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run wiki-template
& 'C:\Program Files\nodejs\npm.cmd' run wiki-apply
```

## 릴리즈와 자동 업데이트

- 현재 배포 방식은 `electron-builder` + `NSIS` + GitHub Releases다.
- `package.json`의 `build.publish`는 `latte4today/ER-Team-Picker-app`을 바라본다.
- 자동 업데이트를 위해 GitHub Release에는 설치 exe만 올리면 부족하다. `dist`에 생성되는 다음 파일을 함께 올려야 한다.

```text
ER Team Picker Setup *.exe
latest.yml
*.exe.blockmap
```

- `electron-updater`는 설치된 앱에서만 의미 있게 동작한다. `npm run app` 개발 실행에서는 자동 업데이트가 꺼져 있다는 안내가 나올 수 있다.
- 버전을 올릴 때는 최소한 다음 파일을 함께 확인한다.

```text
package.json              build/version 기준
src/updateConfig.js       앱 내부 표시/비교 버전
```

## 데이터와 추천 로직 흐름

```text
src/data.js
src/wikiMetrics.js
src/combatProfiles.js
src/tournamentMeta.js
src/metaData.js
src/feedback.js
src/supabaseFeedback.js
        ↓
src/recommender.js
        ↓
src/app.js
        ↓
index.html UI
```

- 캐릭터 역할/무기/태그/이미지 경로는 `src/data.js`를 우선 확인한다.
- 교전 성향은 `src/combatProfiles.js`를 우선 확인한다.
- 대회 조합 보정은 `src/tournamentMeta.js`를 우선 확인한다.
- DAK.GG 랭커/통계 기반 보정은 `src/metaData.js`를 확인하되, 이 파일은 매우 크므로 필요한 symbol만 검색한다.
- 설명 문구는 `src/recommender.js`의 `explain()`과 `teamFeatureSummary()` 계열을 우선 확인한다.
- 유니온 추천 설명은 `src/app.js`의 `unionComboReason()`과 `unionComboPlan()`을 확인한다.

## Supabase 관련 주의

- 클라이언트에는 anon public key만 둔다.
- service role key는 절대 `src/`, GitHub, 앱 패키지에 넣지 않는다.
- 서버 저장 실패가 나면 `src/feedback.js`의 pending queue와 `flushPendingRemoteFeedback()` 흐름을 확인한다.
- 투표 제한은 현재 하루 단위가 아니라 `vote_bucket` 기반이다. 로컬 코드와 `supabase/schema.sql`의 unique index가 맞아야 한다.
- 문의 메일 전송은 Edge Function secret에 의존한다.

필요 secret:

```text
RESEND_API_KEY
CONTACT_TO_EMAIL
CONTACT_FROM_EMAIL   선택. 없으면 Resend 기본 발신자 사용.
```

## 로컬 저장소

- Electron은 `session.fromPartition("persist:er-team-picker")`를 사용한다.
- 포트가 매번 달라져도 localStorage가 유지되도록 설계되어 있다.
- 주요 localStorage 키:

```text
er-team-picker-theme
er-team-picker-playable-variants
er-team-picker-playable-presets-v1
er-team-picker-union-rosters
```

## 검증 명령

수정 후 가능한 범위에서 문법 검사를 돌린다.

```powershell
& 'C:\Program Files\nodejs\node.exe' --check src\app.js
& 'C:\Program Files\nodejs\node.exe' --check src\recommender.js
& 'C:\Program Files\nodejs\node.exe' --check src\data.js
& 'C:\Program Files\nodejs\node.exe' --check electron\main.cjs
& 'C:\Program Files\nodejs\node.exe' --check electron\preload.cjs
```

## 작업 규칙

- 파일은 UTF-8로 유지한다.
- PowerShell 출력에서 한국어가 깨져 보일 수 있다. 파일이 실제로 깨졌는지 확인하려면 Node `fs.readFileSync(path, "utf8")`로 읽어서 확인한다.
- 실제로 깨진 문자열이 이미 일부 파일에 남아 있을 수 있으므로, 한국어 문구를 건드릴 때는 해당 구간을 정상 한국어로 정리한다.
- 캐릭터 이름 뒤 조사는 받침 여부를 고려한다. `라우라이`, `루크이` 같은 문구가 나오지 않게 `josa()` helper를 사용하거나 추가한다.
- `src/metaData.js`는 큰 생성 파일이므로 작은 수동 수정은 피하고, 가능하면 collector나 데이터 생성 과정을 통해 갱신한다.
- `dist/`, `release/`, `node_modules/`, `data/dak-cache/`, `.env*`, 빌드된 exe/zip/msi/lnk는 GitHub에 올리지 않는다.
- 빌드 파일은 코드 수정 후 매번 자동으로 바뀌지 않는다. 배포하려면 반드시 다시 `npm run installer-win`을 실행한다.
- 기존 사용자 변경을 되돌리지 말고, 관련 파일은 변경 전후 맥락을 확인한다.
