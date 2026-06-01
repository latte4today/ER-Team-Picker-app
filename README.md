# ER Team Picker

이터널 리턴 스쿼드 조합 추천 데스크톱 앱입니다.

팀원이 고른 실험체 2명을 입력하면, 현재 조합에 어울리는 내 실험체와 무기 후보를 추천합니다. 내가 실제로 고른 픽은 경기 후 `좋았음 / 별로였음`으로 평가할 수 있고, 이 평가는 다음 추천 점수에 반영됩니다.

## 주요 기능

- 팀원 1, 팀원 2, 내 픽을 실험체 카드 클릭으로 빠르게 입력
- 추천 후보를 별도 탭에서 넓게 확인
- 내가 할 수 있는 실험체 목록을 지정하면 그 안에서만 추천
- DAK.GG 랭커/티어 데이터를 반영한 메타 보정
- Supabase를 이용한 사용자 평가 저장
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

## 설치 파일 만들기

공유용 앱 폴더를 만들려면:

```powershell
npm run package-win
```

설치 파일을 만들려면 Inno Setup 6 설치 후:

```powershell
npm run installer-win
```

생성된 설치 파일은 GitHub의 `Releases`에 올리면 됩니다. 사용자는 소스 코드를 받는 대신 `ER-Team-Picker-Setup.exe`를 다운로드해서 설치하면 됩니다.

## GitHub에 올릴 때

이 저장소는 `.gitignore`로 아래 파일들을 제외합니다.

- `node_modules/`
- `dist/`
- `release/`
- `data/dak-cache/`
- `.env`
- 실행 파일, 압축 파일, 임시 파일

코드를 수정한 뒤 GitHub Desktop에서:

1. 변경사항 확인
2. Summary 입력
3. `Commit to main`
4. `Push origin`

순서로 올리면 GitHub에 반영됩니다.

## Supabase 설정

`src/supabaseConfig.js`에 Supabase URL과 anon public key를 넣으면 사용자 평가를 서버에 저장할 수 있습니다.

주의: service role key는 절대 클라이언트 앱이나 GitHub에 올리면 안 됩니다.

Supabase SQL은 `supabase/schema.sql`에 있습니다.

## 데이터 갱신

공식 API를 붙이기 전까지는 DAK.GG의 공개 데이터를 기반으로 `src/metaData.js`를 생성합니다.

```powershell
npm run collect-dak
```

기본 설정은 랭커 200명과 최근 랭크 스쿼드 경기 데이터를 수집합니다. 수집 캐시는 `data/dak-cache/`에 저장되며 GitHub에는 올리지 않습니다.
