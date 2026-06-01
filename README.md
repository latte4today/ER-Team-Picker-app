# ER Team Picker

이터널 리턴 스쿼드 조합 추천 데스크톱 앱입니다.

팀원이 고른 실험체 2명과 내가 실제로 고른 픽을 입력하면, 현재 조합에 어울리는 실험체와 무기 후보를 추천합니다. 경기 후에는 내가 고른 픽을 `좋았음` / `별로였음`으로 평가할 수 있고, 이 평가는 이후 추천 점수와 실험체 간 궁합 분석에 반영됩니다.

## 주요 기능

- `조합 구성` 탭에서 팀원 1, 팀원 2, 내 픽을 실험체 카드 클릭으로 입력
- 현재 조합에 맞는 추천 후보를 조합 구성 화면 안에서 바로 표시
- 추천 이유에 역할군, 무기, 평타딜/스킬딜, 교전 기능을 함께 설명
- 사용자 평가 데이터를 기반으로 실험체 간 실제 궁합 점수를 학습
- 내가 할 수 있는 실험체 목록을 지정하면 해당 목록 안에서만 추천
- `추천 후보` 탭에서 사용자 추천 조합, 최근 추천 조합, DAK.GG 기반 실험체 랭킹 표시
- DAK.GG 랭커 전적과 실험체 티어 데이터를 활용한 메타 보정
- Supabase를 이용한 경기 후 평가 저장
- 앱 안에서 문의를 남길 수 있는 문의함 제공
- 문의 수신 메일 주소는 Supabase Secret으로 관리해 앱과 GitHub에 노출하지 않음
- 스크린샷 파일, Ctrl+V 붙여넣기, 현재 화면 캡처 지원
- 다크 모드 UI
- Windows 데스크톱 앱 실행 및 패키징

## 실행 방법

Node.js가 설치되어 있어야 합니다.

```powershell
npm install
npm run app
```

PowerShell에서 `npm`이 잡히지 않으면 아래처럼 실행할 수 있습니다.

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run app
```

개발 중에는 `run-app.bat` 또는 프로젝트/바탕화면의 `ER Team Picker` 바로가기를 사용해도 됩니다. 이 바로가기는 최신 소스 기준으로 앱을 실행합니다.

## 설치 파일 만들기

공유용 앱 폴더를 만들려면:

```powershell
npm run package-win
```

설치 파일을 만들려면 Inno Setup 6 설치 후:

```powershell
npm run installer-win
```

생성된 설치 파일은 GitHub의 `Releases`에 올리면 됩니다. 사용자는 소스 코드를 받는 대신 `ER-Team-Picker-Setup.exe`를 다운로드해서 설치할 수 있습니다.

주의: 이미 만들어진 `dist` 폴더의 exe는 빌드 당시 코드가 들어간 고정본입니다. 코드를 수정한 뒤 배포하려면 다시 패키징해야 합니다.

## GitHub에 올릴 때

이 저장소는 `.gitignore`로 아래 파일들을 제외합니다.

- `node_modules/`
- `dist/`
- `release/`
- `data/dak-cache/`
- `.env`
- 실행 파일, 압축 파일, 바로가기, 임시 파일

코드를 수정한 뒤 GitHub Desktop에서:

1. 변경사항 확인
2. Summary 입력
3. `Commit to main`
4. `Push origin`

순서로 올리면 GitHub에 반영됩니다.

## Supabase 설정

`src/supabaseConfig.js`에 Supabase URL과 anon public key를 넣으면 사용자 평가와 문의를 서버에 저장할 수 있습니다.

주의: service role key는 절대 클라이언트 앱이나 GitHub에 올리면 안 됩니다.

Supabase SQL은 `supabase/schema.sql`에 있습니다. SQL Editor에서 실행하면 아래 테이블과 view가 준비됩니다.

- `recommendation_votes`
- `recommendation_feedback_summary`
- `contact_messages`

Authentication 설정에서 Anonymous sign-ins가 켜져 있어야 합니다.

## 문의 메일 자동 전달

앱의 `문의 보내기` 기능은 먼저 Supabase `contact_messages` 테이블에 문의를 저장합니다. 메일 자동 전달을 사용하려면 Supabase Edge Function과 메일 발송 서비스가 필요합니다.

Edge Function 코드는 아래 파일에 있습니다.

```text
supabase/functions/contact-notify/index.ts
```

Supabase Edge Function 이름은 반드시 아래처럼 설정해야 합니다.

```text
contact-notify
```

Supabase Edge Function Secrets에는 아래 값을 등록합니다.

```text
RESEND_API_KEY=Resend에서 받은 API 키
CONTACT_TO_EMAIL=문의 받을 운영자 이메일
CONTACT_FROM_EMAIL=ER Team Picker <onboarding@resend.dev>
```

`CONTACT_TO_EMAIL`은 Supabase Secret에만 저장되므로 앱 사용자나 GitHub에 노출되지 않습니다.

## 데이터 갱신

공식 API를 붙이기 전까지는 DAK.GG의 공개 데이터를 기반으로 `src/metaData.js`를 생성합니다.

```powershell
npm run collect-dak
```

기본 설정은 랭커 200명과 최근 랭크 스쿼드 경기 데이터를 수집합니다. 수집 캐시는 `data/dak-cache/`에 저장되며 GitHub에는 올리지 않습니다.

## 추천 점수 개요

추천 점수는 아래 요소를 함께 반영합니다.

- 팀원과 후보 실험체의 역할 조합
- 이니쉬, 포커싱, CC, 포킹, 지속딜, 아군 보호 같은 교전 기능
- 평타딜/스킬딜 비중
- 무기와 교전 거리
- DAK.GG 랭커 조합 데이터
- 실험체 티어 데이터
- 사용자의 경기 후 평가
- 누적 평가 데이터에서 분석한 실험체 간 궁합 점수

데이터가 적은 조합은 과하게 믿지 않도록 약하게 반영하고, 평가가 충분히 쌓인 조합은 추천 점수에 더 강하게 반영합니다.
