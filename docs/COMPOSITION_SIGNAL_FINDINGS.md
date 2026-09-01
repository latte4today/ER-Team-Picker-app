# What actually carries composition signal

Measured 2026-09-02 against ranked season-41 games from the durable archive.
Written down because most of it is negative results, and negative results are the
expensive kind to rediscover.

## How things were measured

- **AUC** — `P(the score rates a winning team's actual pick above a losing team's
  pick)`. Balanced win/loss samples, held-one-out: hide one member of a real
  3-person team, score the pick that team actually made. 0.5 is no signal.
- **Retrieval** — hide one member, rank the whole candidate pool, see where the
  real pick lands (MRR, hit@3, hit@12). This is the recommendation-quality metric.
  Random baseline on this pool: MRR ~0.0335, hit@3 ~1.76%, hit@12 ~7.04%.
- `recommend()` caps its output at 48 rows. Retrieval must raise
  `DIVERSITY_CONFIG.resultCap`, or the true pick falls outside the list ~62% of the
  time and MRR measures the cutoff instead of the ranking.

## Signal ranking (5,400 evaluations, season 41 only)

| component | fires | AUC |
|---|---|---|
| pair synergy (official pair stats) | 100% | **0.6154** |
| 3-person composition | 96% | 0.5380 |
| character strength alone | 100% | 0.5323 |
| officialPairRole | 62% | 0.5211 |
| structural fit terms | 100% | **0.4940** |

Structural fit is roleBalance + coverage + teamShape + compositionGuide. Below 0.5
means it points the wrong way.

Adding all the team-context machinery to a character-only score moves AUC from
0.5195 to 0.5184 — the composition apparatus nets out to nothing, because the one
strong term is cancelled by the weak ones.

## Hand-designed composition features do not work

Eighteen draft-time team features screened against top-3 finish, 6,000 top-3 teams
vs 6,000 not:

```
roles: dealer count            0.5205
weapons: ranged count          0.5155
roles: distinct count          0.5108
cc: total profile weight       0.5106
cores: distinct groups         0.5059
roles: has frontline/bruiser   0.4964
weapons: melee+ranged mix      0.4981
damage: distinct types         0.4995
```

Nothing clears ±0.021. Empirical pair data clears +0.108. Which specific characters
are together matters; how many frontliners there are does not. Note that having a
frontline is very slightly negative, consistent with the earlier finding that
"no frontline" should not be penalised.

Do not expect a new hand-designed structural feature to help. That avenue is
measured out.

## Rebalancing the weights toward pair synergy: rejected

Since pair synergy is the strong term and structural fit is the harmful one, the
obvious move is to reweight. On AUC it works, consistently, across samples:

```
shipped                                    0.5207
fitWeight 0 + heuristicWeight 0            0.5294
^ + pairWeight 2.1                         0.5485
^ + selectedStrengthWeight 0.30            0.5626
^ + selectedStrengthWeight 0               0.5892
```

It does not survive the metric that matters. Held-out, 450 teams, 1,350
evaluations, paired bootstrap over the same evaluations:

```
                        MRR      hit@3    hit@12
shipped                 0.0404   1.78%    13.11%
pair2.1 str0.30         0.0407   2.52%    11.04%
pair1.4 str0.45         0.0349   1.93%     9.48%

pair2.1 str0.30  MRR    +0.0003  95% CI [-0.0045, +0.0047]   no difference
pair2.1 str0.30  hit@3  +0.0074  95% CI [-0.0007, +0.0185]   no difference
pair2.1 str0.30  hit@12 -0.0207  95% CI [-0.0326, -0.0089]   significantly worse
pair1.4 str0.45  MRR    -0.0055  95% CI [-0.0087, -0.0013]   significantly worse
```

**AUC on "winning team's pick" is not a proxy for recommendation quality.**
Optimising it degrades hit@12, which is the one place the recommender has real
signal. The shipped weights were left alone.

## Turning on the disabled 3-person composition stats: rejected

`officialMatchScore` carries a commented-out call to `officialCompositionScore`
with "disabled until data volume is sufficient". The data is there now — 46,857
triples in the ranked bundle, up to 397 games each — so the stated reason has
expired. It still does not help: AUC 0.5380 against 0.6154 for pair synergy, and
giving it weight lowered total AUC (0.5485 → 0.5449). Three-person cells split the
evidence too thin to beat the two-person ones.

Exposing it (plus `leanPairSynergyTerm` and `officialPairSynergyScore`) as
diagnostics costs real time: one-pick recommendation went 33ms → 73ms. Reverted.

## Where the recommender actually stands

Against a random baseline, on the held-out ranked sample:

- hit@12 is roughly 1.6-1.9x random — it genuinely narrows ~170 candidates to a
  plausible dozen.
- hit@3 and MRR sit at or near random — it does not order within that dozen.

Retrieval numbers are noisy. The same shipped config measured hit@3 = 2.42% on 110
teams and 3.64% on 55 teams from the same held-out block. Anything under a few
hundred teams cannot separate two configs; use the paired bootstrap.

## Still open

- `relationship` never fires (0%) and `synergy` fires 3.3% off 17 hand-written
  pairs. Both occupy weight in the total.
- `pairSynergyLift` is a June build covering 40 of 90 characters. The lean pair
  term prefers it over live official pair stats and scores slightly worse for it
  (AUC 0.6067 vs 0.6154).
- CI builds stats from a corpus of ~800k teams while the durable archive holds
  2.6M; the workflow only re-materialises on a cache miss.
