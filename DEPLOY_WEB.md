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

Vercel creates a new production deployment automatically within a few minutes -
unless the commit only moved collected statistics, in which case it is skipped.

## Free-tier storage

Every deployment is retained and counts against the free tier's 10GB. The project
reached 100% of it because six CI jobs push per day and each push deployed a 74MB
tree. Two things keep it down, and one is manual:

- `.vercelignore` drops what the browser never asks for - collector data, tools,
  docs, the desktop shell, and `src/officialMatchStats.compact.json`, which the
  app fetches from raw.githubusercontent.com rather than from the deployment.
  74MB -> 32MB.
- `scripts/vercel-should-build.sh`, wired up as `ignoreCommand` in `vercel.json`,
  skips deployments for commits that only change collected stats. Those never
  needed one: the app reads stats from GitHub at runtime, so a stats commit is
  live for every visitor the moment it lands on main. Replayed over the last 12
  commits, 7 skip and 5 build.

Together that is roughly five times the headroom, but neither reclaims what is
already stored. **Old deployments have to be deleted by hand** in the Vercel
dashboard (Project -> Deployments -> ... -> Delete), or by setting a shorter
retention period if the plan offers one. Until that is done the project stays at
100% however small new deployments get.

## Version Display

The web sidebar version comes from `src/updateConfig.js`.

Current release: `v0.3.6 · web`
