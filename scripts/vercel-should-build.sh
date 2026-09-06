#!/usr/bin/env bash
# Vercel "Ignored Build Step". Exit 0 = skip the deployment, exit 1 = build it.
#
# Six CI jobs push to main every day and almost all of those commits only move
# collected statistics. Each one was producing a full deployment, and every
# deployment is retained against the free tier's 10GB - which is how a hobby
# project hit 100% of it.
#
# Those deployments were never needed. The app reads its stats from
# raw.githubusercontent.com at runtime (src/app.js), so a stats commit is live
# for every visitor the moment it lands on main, deployed or not. What ships in
# the bundle is only the offline fallback, used when that fetch fails; letting it
# lag behind the remote copy by a few days costs nothing, and the next real code
# change refreshes it.
#
# Anything that changes what the app *is* - markup, code, styles, images,
# config - still deploys.

set -uo pipefail

# Files that only feed the recommender and are re-fetched at runtime anyway.
DATA_ONLY=(
  ':(exclude)src/officialMatchStats.js'
  ':(exclude)src/officialMatchStats.compact.json'
  ':(exclude)src/officialMatchStats.json'
  ':(exclude)src/metaData.js'
  ':(exclude)src/pairRoleStats.js'
  ':(exclude)src/pairSynergyLift.js'
  ':(exclude)src/dakggRealtimeStats.js'
  ':(exclude)src/tournamentMeta.js'
  ':(exclude)src/compModel.json'
)

# Only these ever reach the browser.
DEPLOYED=(index.html src assets vercel.json .vercelignore)

if ! git rev-parse --verify --quiet HEAD^ >/dev/null; then
  echo "no parent commit to compare against; building"
  exit 1
fi

if git diff --quiet HEAD^ HEAD -- "${DEPLOYED[@]}" "${DATA_ONLY[@]}"; then
  echo "only collected data changed; skipping deployment"
  echo "(the app fetches stats from raw.githubusercontent.com, so main is already live)"
  exit 0
fi

echo "app files changed; building"
git diff --name-only HEAD^ HEAD -- "${DEPLOYED[@]}" "${DATA_ONLY[@]}" | sed 's/^/  /'
exit 1
