# v0.2.1

## Summary

Mobile layout fixes, recommender tuning, i18n completion, and web cache fixes.

## What's New

### Mobile Responsive Layout

- The web deployment now works properly on mobile browsers.
- Sidebar navigation moves to a fixed bottom tab bar on small screens.
- Main content becomes vertically scrollable instead of being locked by shell overflow.
- Setup, recommendation, ranking, and union views collapse into mobile-friendly layouts.
- Character grids and recommendation lists use bounded scrolling for smaller screens.
- `100dvh` and safe-area insets improve mobile browser chrome behavior.

### Recommender Tuning

- Silvia is no longer treated as a short-range ranged dealer, preventing an inflated ranged-composition bonus.
- Magnus hammer is treated as a brawling engage tank rather than a protective tank in one-frontline compositions.
- Laura receives a small penalty in all-melee compositions where she previously over-covered burst, initiate, and area control at once.

### i18n Fixes

- Japanese, Simplified Chinese, and Traditional Chinese received missing recommender, role, CC, and metric translation keys.
- All five language dictionaries now have matching key counts.
- Recommendation reasons and metric labels are translated through the i18n layer.

### Web Deployment

- Static `src/*` and `assets/*` files are no longer served with immutable one-year cache headers.
- Entry script URLs include the release query string so users see the latest web version after deployment.
