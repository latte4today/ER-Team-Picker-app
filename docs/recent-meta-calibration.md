# Recent meta calibration

The cumulative outcome term previously drove the recent DAK outcome contribution to zero after 260 observations. Recent outcomes now have a separate bounded path to individual strength; that term still participates in composition recommendations. Existing pair/structural weights are unchanged.

## Data and scoring

- Public DAK.GG Rank/Squad aggregates for every offered character/weapon, current patch, `dt=7`. Diamond+ and Mithril+ are separate overlapping cohorts, never summed.
- The source's update timestamp, not our fetch timestamp, determines freshness. Full collection fails on missing variants, invalid sums or patch transitions. Only aggregate fields are retained; player and route payloads are discarded.
- A source-cohort-relative score uses TOP 3, wins and average placement in the existing strength units. Blend: `0.35 × tierTransfer × freshness × n/(n+1500)`. The difference from historical strength is capped at ±0.45 before existing team-context weights. At least 300 observations are required. These are conservative initial policy parameters, not outcome-optimized estimates.
- Transfer weights: all=.5; platinum/diamond=.6; diamond=.8; meteor/mithril=.8; mithril+=1; demigod/eternity=.7. These buckets do not exactly match source cohorts; the UI names the actual cohort. Lower tiers receive no high-tier correction. A cohort is not a substitute for precise player-skill adjustment.
- Full freshness through day 2, then linear fade to zero at day 7. Source data more than one day in the future is rejected by the freshness path. Hourly cache versions and periodic refreshes allow expiration even if collection/network requests fail.
- Current core options require 100 observations and 5% of that variant, up to four choices. Only whitelisted current core mechanics are accepted. Historical manual lists are offline/low-tier fallbacks. Rare explicit cores retain their own observed counts, never another core's counts.
- Current core outcome differences use `n/(n+900)` shrinkage and the same tier/freshness transfer. The shown core is the engine's scored core. A manually selected core remains selected.
- Recent outcome sample counts must not reweight historical damage/CC measurements or redefine combat identity. Those measurements and reviewed intrinsic/core mechanics have a separate path.
- Popularity has no direct strength bonus. Pick share is used to screen practical core choices and report usage changes only.

## User-facing evidence

Raw source cohorts, patch/update metadata and outcome counts remain internal scoring evidence. The UI does not show provider branding, source links or separate provider-statistics boxes. Recommendation details offer a frequently completed five-item build with official Korean item names, without presenting its completion-biased outcome rates as expected wins. Existing cumulative ranking statistics are unaffected. Build growth is not inferred without historical build observations.

The dashboard separates pick-share growth, TOP 3 improvement, and a dedicated Mithril+ usage panel in aligned identity/change rows. The previous-patch reference is whatever the source supplies; window lengths and populations can differ. These are descriptive changes, not causal patch effects. At least 500 observations per period, absolute effect thresholds, and a conservative z≥4 screening threshold reduce noisy alerts, but repeated players/teams are not independent trials. Opponent examples automatically advance when recommendation or dashboard details are opened again; there is no manual example-refresh control. Closed matchup panels still do no analysis.

## Refresh and validation

An independent job in the existing daily DAK workflow publishes complete JSON and bundled JS snapshots, runs calibration checks, and refreshes the recommendation regression baseline. Existing deployments fetch the JSON at startup and every four hours, validate it, reject rollbacks, clear dependent caches, and retain the bundle when offline. Data-only changes do not create redundant Vercel deployments. A failed collection does not replace the last complete published snapshot.

`node tools/test_recent_meta.mjs` covers the final score path, no popularity bonus, no low-tier transfer, bounded influence, tiny samples, stale cached-core expiration, runtime replacement/rollback/malformed data, practical core eligibility, real evidence/dashboard HTML, and shown-core consistency. Existing mechanics, diagnosis, search and cache tests remain required.

Improved static ranking agreement with these same source data is not independent evidence of better wins. Next calibration needs a frozen, game-disjoint, future-patch holdout; actual win-rate claims require prospectively linked match outcomes and a properly powered randomized comparison. No outcome collection or A/B assignment is activated by this release.
