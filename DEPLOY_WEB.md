# 웹 배포 가이드 (Vercel)

## 1회 설정 (최초 1번만)

### 1. Vercel 가입
https://vercel.com 접속 → **Continue with GitHub** 로 로그인

### 2. 프로젝트 연결
1. Vercel 대시보드 → **Add New Project**
2. GitHub 저장소 목록에서 `eternal-return-team-picker` 선택 → **Import**
3. 설정 화면에서 아무것도 바꾸지 않고 **Deploy** 클릭

> Framework Preset: Other, Build Command: 없음, Output Directory: `.` (루트)

### 3. 완료
배포가 끝나면 `https://your-project.vercel.app` 주소가 생성됩니다.

---

## 이후 업데이트 (git push만 하면 자동)

```
파일 수정 → git add . → git commit -m "..." → git push
```

Vercel이 push를 감지하고 1~2분 안에 자동으로 웹사이트에 반영됩니다.

---

## 커스텀 도메인 연결 (선택)

Vercel 프로젝트 설정 → **Domains** → 도메인 입력 → DNS 레코드 추가

---

## 웹 버전 동작 차이

| 기능 | 앱 | 웹 |
|---|---|---|
| 업데이트 버튼 | 자동 업데이트 | 숨김 (항상 최신) |
| 버전 표시 | 사이드바 하단 | `v0.1.9 · web` |
| 나머지 모든 기능 | ✅ | ✅ 동일 |
