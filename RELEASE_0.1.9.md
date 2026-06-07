# v0.1.9

## Summary
유니온 뷰 UX 개선 — 프리셋 드롭다운, 성능, 스플래시 스크린, 언어 지속성 수정

---

## GitHub Release Description

### ✨ What's New

**Union Preset Dropdown Redesign**
- Replaced the native `<select>` (which required holding the mouse button to keep the list open) with a custom dropdown
- Click to open, click an item to select and close — standard expected behavior
- All 4 player rows share the same preset list; selected preset is tracked per row
- Visual indicator (▾ arrow) rotates when open; selected item is highlighted
- Clicking outside the panel closes any open dropdown

**Splash Screen**
- Replaced the character-image splash with a minimal loading screen (dark background, app icon, app name, CSS spinner) inspired by OP.GG Desktop

**Language Persistence Fix**
- Language selection gate no longer appears on every app restart
- Root cause: random server port on each launch created a new `localStorage` origin, losing all settings
- Fixed by using a fixed port (`34579`) so the origin stays stable across sessions

---

### 🐛 Bug Fixes

**Union Calculation Lag**
- Severe freeze when clicking characters in union view has been resolved
- Root cause: `dakCompositionScore` and `tournamentCompositionScore` were doing O(n) `.filter()` scans (2,333+ rows) on every `evaluateCandidate()` call
- Fix: pre-built `Map` indexes at module load time → O(1) lookup per call
- `tournamentArchetypeScore` also pre-resolves character objects and member sets to eliminate repeated `.find()` calls

**Union — Calculate on Demand**
- Union combos no longer auto-calculate on every character click
- Results are now computed only when the "조합 계산" button is clicked, eliminating repeated heavy computation during roster building

**Union Preset — Scroll Preserved on Load**
- Loading a preset no longer destroys the character grid scroll position
- Fix: stopped calling full `innerHTML` rebuild on load; only the character grid and player tabs are updated

---

### 🔧 Internal Changes

- `renderUnion()` no longer calls `renderUnionResults()` (decoupled from auto-calculation)
- `updateUnionPresetDropdowns()` does targeted DOM updates without full panel rebuilds
- `closeUnionPresetDropdowns()` / `closeUnionPresetDropdown()` helpers manage dropdown open state
- `normalizeUnionPresetStorage()` handles both legacy per-player object format and current flat array format
- Added `preset.selectPlaceholder` i18n key (ko/en/ja/zh-Hans/zh-Hant)
