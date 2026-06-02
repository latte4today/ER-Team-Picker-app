# Screen Detection Notes

이 문서는 화면 인식 기능을 나중에 다시 추가하기 위한 내부 참고용 문서입니다. 공개 README나 Release 설명에는 포함하지 않습니다.

## 현재 상태

스크린샷 기반 팀 슬롯 인식 기능은 `v0.1.2` 배포에서 제거했습니다.

제거 이유:

- 스킨 이미지에 따라 실험체 mini 이미지 매칭 오차가 큼
- 실제 픽/루트 화면 UI 상태에 따라 하단 슬롯 좌표가 달라질 수 있음
- 오인식된 팀 조합이 추천 점수와 사용자 평가 데이터를 오염시킬 수 있음

현재 앱은 실험체 카드를 클릭해 수동으로 `팀원 1`, `팀원 2`, `나` 순서로 입력하는 방식입니다.

## 남아 있는 관련 파일

화면 인식 기능을 완전히 폐기한 것은 아니며, 참고용 구현 파일은 남겨둡니다.

- `src/detector.js`
  - 스크린샷에서 팀 슬롯 후보를 찾는 핵심 로직
  - 캐릭터 mini 이미지와 무기 템플릿을 비교
- `src/skinTemplates.js`
  - 스킨 이미지 템플릿 추가용
- `src/weaponTemplates.js`
  - 무기 아이콘 템플릿 연결
- `assets/characters/mini/`
  - 기본 실험체 mini 이미지
- `assets/weapons/`
  - 무기 아이콘 이미지

## 다시 추가할 때 필요한 UI

`index.html`의 조합 구성 영역에 별도 패널로 다시 추가하는 편이 좋습니다.

추천 위치:

```text
조합 구성
- 팀 선택
- 실험체 선택
- 화면 인식(접이식 또는 별도 버튼)
- 추천 후보
- 경기 후 평가
```

권장 UI:

- `화면 인식 사용` 버튼
- 스크린샷 선택
- 현재 화면 캡처
- 인식 결과 미리보기
- 인식 결과를 바로 적용하지 않고 `적용` 버튼을 눌러 반영
- 인식된 결과마다 신뢰도 표시
- 사용자가 오인식 항목을 바로 수정할 수 있는 슬롯 선택 UI

중요:

- 인식 결과를 자동으로 팀 조합에 바로 넣지 않는 것이 안전합니다.
- 사용자가 확인 후 적용하도록 해야 추천/평가 데이터 오염을 줄일 수 있습니다.

## 다시 추가할 때 필요한 앱 흐름

기존에 제거한 흐름은 대략 다음과 같습니다.

```text
스크린샷 입력
→ 이미지 미리보기
→ detectTeamFromScreenshot(image, canvas)
→ 슬롯별 후보 표시
→ 사용자가 확인/수정
→ 팀원 1, 팀원 2, 나 슬롯에 반영
→ 추천 후보 갱신
```

다시 추가할 때 `src/app.js`에 필요한 상태:

```js
let screenshotImage;
let screenStream;
```

필요한 DOM:

```js
const screenshotInput = document.querySelector("#screenshot-input");
const screenCaptureButton = document.querySelector("#screen-capture-button");
const clearScreenshotButton = document.querySelector("#clear-screenshot-button");
const detectButton = document.querySelector("#detect-button");
const captureCanvas = document.querySelector("#capture-canvas");
const screenshotPreview = document.querySelector("#screenshot-preview");
const capturePreview = document.querySelector("#capture-preview");
```

필요한 import:

```js
import { detectTeamFromScreenshot } from "./detector.js";
```

## 스킨 인식 개선 과제

다시 넣기 전에 아래 개선이 필요합니다.

### 1. 스킨 템플릿 확장

기본 mini 이미지만으로는 스킨 적용 이미지와 차이가 큽니다.

작업:

- 자주 보이는 스킨별 mini 이미지를 `assets/characters/skins/` 같은 별도 폴더에 저장
- `src/skinTemplates.js`에 캐릭터별 후보 템플릿으로 등록
- 기본 이미지와 스킨 이미지를 모두 비교

### 2. 슬롯 좌표 보정

현재 좌표는 특정 화면 비율/상태에 맞춰져 있을 수 있습니다.

작업:

- 실제 게임 픽 화면 16:9, 21:9, 창모드 스크린샷 수집
- 하단 슬롯 위치를 비율 기반으로 재측정
- 슬롯 후보 영역을 약간 넓게 잡고 내부에서 가장 유사한 이미지 탐색

### 3. 신뢰도 기준 강화

낮은 신뢰도 결과는 자동 적용하지 않아야 합니다.

권장:

```text
90% 이상: 자동 후보로 표시
75~90%: 확인 필요 표시
75% 미만: 미인식 처리
```

### 4. 무기 인식은 보조 정보로 취급

무기 아이콘은 작고 UI 상태에 따라 흐려질 수 있습니다.

권장:

- 캐릭터 인식을 우선
- 무기 인식은 보조 신뢰도만 부여
- 캐릭터별 가능한 무기가 여러 개인 경우 사용자가 직접 선택 가능하게 함

### 5. 평가 데이터 보호

화면 인식 결과가 틀린 상태로 경기 후 평가가 저장되면 추천 데이터가 오염됩니다.

권장:

- 화면 인식으로 들어온 조합에는 `인식 결과 확인됨` 상태를 둠
- 사용자가 수동 확인한 뒤에만 평가 저장 가능하게 하거나, 최소한 경고 표시
- Supabase 저장 시 `source = manual | detection` 같은 필드를 추가하는 것도 고려

## 향후 구현 아이디어

- 화면 인식 기능을 기본 기능이 아니라 `실험 기능`으로 표시
- 설정에서 `화면 인식 베타 기능 켜기` 토글 제공
- 인식 실패/오인식 신고 버튼 추가
- 오인식 스크린샷을 사용자가 동의한 경우에만 수집해 템플릿 개선에 사용
- 공식 API가 연결되면 화면 인식 의존도를 줄이고 API 기반 픽 정보로 대체

## 공개 전 체크리스트

- 실제 게임 화면 30장 이상으로 테스트
- 스킨이 섞인 화면 30장 이상으로 테스트
- 오인식률 기록
- 신뢰도 낮은 결과가 자동 적용되지 않는지 확인
- 화면 인식으로 입력된 조합이 사용자 평가 데이터에 바로 섞이지 않는지 확인
- 앱 레이아웃이 수동 입력 흐름을 방해하지 않는지 확인
