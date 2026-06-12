# Web Deployment Guide (Vercel)

## Initial Setup

1. Open https://vercel.com and sign in with GitHub.
2. Select **Add New Project**.
3. Import `latte4today/ER-Team-Picker-app`.
4. Use these settings:
   - Framework Preset: Other
   - Build Command: empty
   - Output Directory: `.`
5. Click **Deploy**.

The production site is served from the repository root. `vercel.json` rewrites all routes to `index.html` and keeps `index.html`, `src/*`, and `assets/*` on `no-cache` so version updates are visible after a redeploy.

## Updating The Site

Commit and push changes to `main`.

```powershell
git add .
git commit -m "Update web app"
git push
```

Vercel should create a new production deployment automatically within a few minutes.

## Version Display

The web sidebar version comes from `src/updateConfig.js`.

Current release: `v0.2.1 · web`
