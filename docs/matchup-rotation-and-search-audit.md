# Matchup examples and recommendation search audit (2026-11-05)

Opponent examples now use a rotating deck of actual observed lineups that meet
the current team's tactical condition. Reopening details or selecting “Other
examples” advances the deck. Incidental renders keep the current page; new
sessions start at a random position. A three-character lineup appears only once
per deck, irrespective of core/weapon variations. Small pools may repeat. These
remain tactical estimates, not measured encounter win rates.

Full-team search previously spent several of its eight first-teammate and three
second-teammate branches on different cores of the same character. It now takes
distinct characters, retaining the highest ranked build for each branch. When
the same pair is discovered by another path, the higher scoring path is retained.
Ordering uses the sum of three-decimal totals; the displayed score remains rounded.
The search is still bounded, not exhaustive, and the sum of sequential scores
is not a predicted trio win rate.

The bundled official source was generated at 2026-11-05T08:45:28.974Z and contains
4,121,328 valid teams. Individual records cover all 116 variants in four checked
buckets, and 114/116 in demigod/eternity. Recommendation checks cover finite
scores, excluded selected characters, playable restrictions and slot order.

With the same all-tier data and scoring, comparing source e86972e:

| Anchor | Previous distinct compositions | Updated |
| --- | ---: | ---: |
| Lenox / whip | 16 | 18 |
| Rio / bow | 11 | 24 |
| Eva / throw | 11 | 21 |

Reproduce with `node tools/audit_recommendation_flow.mjs` (requires Git history
containing e86972e). This measures search coverage, not outcome improvement.
Pair scoring still gives archived character-level lifts priority over newer
weapon/tier pair data. The earlier alternative weighting experiment was excluded
because its historical ranking metrics did not establish an improvement.
Independent, later-period outcome evaluation is needed before claiming improved
match performance or releasing new weights.

Validation: matchup guidance and rotation; full-team cache/search regression;
recommendation snapshot; trait selection; dashboard details; union context;
core role profiles; team concepts; tournament sync; syntax and diff checks.
Browser verification was attempted but the browser control connection failed
before page navigation; interaction-level checks use the real renderer and event
handlers in the regression harness.
