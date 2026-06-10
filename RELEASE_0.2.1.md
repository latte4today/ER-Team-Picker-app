# v0.2.1

## Summary
모바일 반응형 지원, 추천 알고리즘 튜닝, i18n 누락 키 보완

---

## GitHub Release Description

### ✨ What's New

**Mobile Responsive Layout**
- The web deployment now works properly on mobile browsers
- Sidebar navigation moves to a fixed bottom tab bar on screens ≤ 599px
- Main content area becomes vertically scrollable (previously locked by `overflow: hidden`)
- All workspace views (setup / recommendations / union) collapse to a single column
- Character grid displays compact 2-column cards with bounded internal scroll
- Recommendation list bounded to 45vh scroll area (full height in recommendations-only view)
- `100dvh` used for shell height to account for mobile browser chrome
- iOS safe-area inset support (`env(safe-area-inset-bottom)`) for notch/home-bar devices
- **Bug fix:** 1100px breakpoint now correctly collapses the setup view workspace to a single column (CSS specificity conflict resolved)

---

### 🎯 Recommender Tuning

**Silvia — over-recommendation fix**
- Removed Silvia from `shortRangeDealerIds`
- Silvia is a bruiser, not a ranged short-range dealer — being in the set was inflating her `weaponBalance` bonus from 0.8 → 1.35 in ranged compositions

**Magnus — brawler tank now penalized in 1탱2원**
- Magnus (hammer) is a dive-engage tank with the highest front damage among tanks, but provides no peel, shield, or healing
- `teamShapeScore`: differentiated 1탱2원 bonus — protective tanks (peel/shield/healing/guard style) get +1.45, brawler tanks get +0.75
- `compositionGuideScore`: added −0.75 penalty when a firstEngage tank with no peel/shield is paired with 2 backline and no melee

**Laura — all-melee composition penalty**
- Laura covers many required tags simultaneously (burst + initiate + area CC), causing her to dominate all-melee compositions
- Added −0.6 penalty when Laura is added to a composition with 3+ melee/tanks and no backline or support
- Remains highly recommended in mixed compositions (intended)

---

### 🌐 i18n Fixes

- Added ~94 missing translation keys to Japanese (`ja.js`), Simplified Chinese (`zhHans.js`), and Traditional Chinese (`zhHant.js`)
- Keys added: `recommender.reason.*`, `recommender.roleNames.*`, `recommender.ccTypes.*`, `metric.tag.*`
- All 5 language files now have identical key sets (570 keys each)
