# Season and patch transitions

- Public current-season metadata is collected independently of complete character
  statistics every four hours. API season IDs (for example 41) and public provider
  keys (for example SEASON_21) are different namespaces; neither is the display
  season number. No future transition date is hardcoded.
- The client refreshes phase, recent outcomes, official tables and composition
  trends every four hours. The existing daily ranker collector remains daily.
  Failed requests retain validated data; older phase/patch metadata cannot roll
  the client back.
- A new phase immediately hides old leaderboard/composition results. Old-phase
  individual, core-outcome and pair-outcome scores are disabled. Structural team
  coverage and reviewed character mechanics keep recommendations usable while
  current outcomes accumulate. Legacy ranker rows cannot fill new-phase gaps.
- Recent cohorts must match both the active phase and patch. Seven-day windows
  crossing the first observed phase boundary are withheld. Patch movers require
  both comparison windows to fall in the current phase and patch family; the
  first observed transition time is conservative, not a claimed launch time.
- Recent individual/core outcomes require minimum samples and shrinkage. Mere
  pick-rate growth does not increase a recommendation score. Recent performance
  also contributes a bounded correction to the character ranking. User votes
  remain a small tiebreaker.
- Official seed collection follows the active API season ID. The archive retains
  history, while newly built app tables use only the latest season in the corpus;
  rows without a season ID are excluded in explicit-season builds. Until a new
  build actually contains the active season, its old tables remain withheld.
- Complete recent-cohort collection is atomic. A failed or lagging statistics
  collection still allows independently detected phase metadata to publish, so
  the old season cannot masquerade as current data. No incomplete cohort is
  published as current. The recommendation baseline is regenerated after rebase.
- New/reworked abilities, traits and items still need a mechanics review; an
  outcome collector does not infer changed skill semantics. No measured win-rate
  improvement is claimed by these guards.

Checks: `node tools/test_season_transition.mjs`, `node tools/test_recent_meta.mjs`,
`node tools/test_ranking_sections.mjs`, `node tools/recommendation_snapshot.mjs`.
