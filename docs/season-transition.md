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
- Recent cohorts must match both the active phase and patch. Ranked windows
  crossing the first observed phase boundary are withheld. A verified
  three-day Ranked window can contribute at half the normal transfer weight
  until both cohorts have a full seven-day window. The first week prioritizes
  team role coverage. Short Ranked windows do not drive trait outcomes or
  patch comparisons. Preseason
  collects a separate Normal/Squad cohort (matching mode 2, team mode 3), so
  an exact-patch preseason sample can be used before seven days elapse.
  Preseason uses a smaller minimum sample and stronger shrinkage-adjusted
  recent score than regular season. Its data is tier-neutral and the UI marks
  results as provisional. Ranked statistics never consume it.
  Ranked patch movers require
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

## Season 13 preseason

13.0 switched the public statistics sample to Normal while Ranked was closed.
The snapshot captured 116 character/weapon builds. Practice trios are generated
from distinct, complementary roles in this sample; they are not observed trio
win rates. Trait picks require a minimum count and share, and Normal build
suggestions exclude builds with top-three rates far below their variant's
observed baseline. Build frequency remains observational, not proof of an item
causing better results. Unknown item IDs are omitted until their names are
resolved. The 13.0 detail notes are scoped to that patch; 13.1 does not inherit
them. The bottom panel displays trends rather than the patch notes.

The preseason pulse uses the latest three days against the earlier part of the
same patch: subtract the three-day counts from the aligned seven-day totals
instead of comparing overlapping windows. Both windows must be the same mode,
patch and collection period; missing or inconsistent rows use the longer
baseline. Short signals expire after 48 hours without a refresh. Pick share is
display-only; a credible TOP 3 change adds a bounded adjustment to scores.
Normal pulse data and thresholds are disabled as soon as Ranked is detected.

Sources: [13.0 systems](https://playeternalreturn.com/posts/news/3948),
[13.0 characters and items](https://playeternalreturn.com/posts/news/3949?hl=ko-KR),
[13.0a announcement](https://steamcommunity.com/app/1049590/allnews?l=english),
[13.0b announcement](https://steamcommunity.com/games/1049590/announcements/detail/708914425087656360).

Checks: `node tools/test_season_transition.mjs`, `node tools/test_recent_meta.mjs`,
`node tools/test_ranking_sections.mjs`, `node tools/recommendation_snapshot.mjs`.
