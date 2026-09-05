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

## The corpus was the biggest single problem (fixed 2026-09-04)

Everything above was measured against stats built from the full archive. What
shipped was not. The collect-seeds workflow only re-materialised the ML corpus
when the file was missing, and a cache-restored corpus is never missing, so the
1.8M teams backfilled into the archive on 2026-08-21 never reached it. Every
stats build since ran on a third of the data:

```
                        source teams   pair-role rows   meteor_mithril   demigod_eternity
shipped (CI)               442,940            815              2                0
rebuilt (full archive)   1,389,762          5,032             78                1
```

That thinning was doing more damage than any weighting decision. Same two-stage
config, same 1,200 held-out season-41 teams, outcome gradient:

```
442,940-team stats     +0.8pp   z=0.28
1,389,762-team stats   +4.4pp   z=1.41
```

`tools/check_corpus_freshness.mjs` now compares corpus coverage against the
archive manifest, and `check_pair_role_stats.mjs` fails when the source-team
count falls below 35% of the archive. Neither is a metric improvement; both stop
this from silently recurring.

## pairSynergyLift was frozen by a schema change, not by neglect

`tools/pair_synergy_lift.mjs` read `members[].characterId` and
`result.placement`. Shards written since carry `players[].character` (official
numeric code) and a top-level `rank`. Against the current corpus the old reader
matched nothing, printed `teams=0`, and exited 0 - so nobody noticed the June
file was never being regenerated. It also had no ranked filter and a 200k scan
cap, and because the corpus is written oldest-shard-first, that cap took the
oldest slice rather than a sample.

Rebuilt ranked-only on the current season: 73 pairs over 40 characters becomes
161 pairs over 71, and the outcome gradient goes +4.4pp to +5.0pp (z 1.41 to
1.59). The tool now defaults to `--min-season current`, refuses to write a file
when it reads zero teams, and records its filters in the generated metadata.

## The 17 hand-written synergy pairs are unreachable, and were guesswork

`data.js` carries 17 hand-written pair ratings that `manualPairFallbackScore`
reads. Two questions: are they right, and do they matter.

Right: no better than chance. Against raw pair lift over 539,719 ranked
season-41 teams, 11 of 17 point the same direction and 6 point the opposite way
(binomial p ~ 0.17 against a coin). None of the 17 clears FDR significance even
at the unfiltered `--fdr 1.0` cut, and the hand values are 2-4x larger than any
lift actually measured for them:

```
lenox:hart        hand +2.6   measured -0.062  (n=169)    OPPOSITE
estelle:hart      hand +2.0   measured -0.143  (n=192)    OPPOSITE
hart:cathy        hand +1.3   measured -0.169  (n=175)    OPPOSITE
rio:yuki          hand +1.8   measured +0.108  (n=1883)   same sign
```

Matter: no. `leanPairSynergyTerm` tries the empirical lift, then the dense
official pair table, and only then this. The dense table always answers first.
Emptying `synergyPairs` entirely changed **0 of 196** recommendation contexts -
not the ordering, not the scores to six decimal places.

So there is nothing to fix and nothing to gain by removing it from the shipped
path. Left in place because the non-lean `pairScore` still reads it, with a
comment at the call site so the next person does not mistake it for evidence.

Coverage, for reference: of 4,005 unordered character pairs, 161 (4.0%) have a
significant lift row and 17 (0.4%) have a hand-written entry. The other 95.6%
rely entirely on the dense official pair table.

## Re-tuning stage 2 on the fixed corpus

Every weight in the two-stage path was chosen against the thin 442k-team stats.
Re-swept on 700 tuning teams (lines 2.2M+), validated on the untouched 1,200-team
held-out block (lines 1.6M-2.1M):

```
config                        gradient    z    variety  overlap  C/D+  ms/call
45 / 3.0 / 0.55  (was)         +5.0pp   1.59      55     9.5%    28%     45
90 / 8.0 / 0     (now)         +8.3pp   2.70      95     6.3%    32%     94
45 / 8.0 / 0                   +4.1pp   1.31      55     9.9%    28%     45
```

z=2.70 is the first result in this file that clears significance.

Two cautions about how this was read. On the tuning block, `45 / 8.0 / 0` scored
+8.1pp and the shortlist axis looked like noise (45, 60, 90, 120 gave 8.1, 4.6,
8.8, 8.6). Held out, that reversed: the shortlist is what carries the result and
45 scores *below* the old config. A single tuning block at n~160 in the top
bucket cannot separate these; only the held-out number was trusted.

`pairRoleWeight` fell monotonically with weight (0, 0.55, 1.2, 2.5 gave 6.3, 3.3,
3.1, 2.1) and is now 0. Growing its table 7.5x by fixing the corpus did not
rescue it - it is a role-shaped proxy for what pairWeight already measures
directly, consistent with its AUC (0.5211 against 0.6154).

Cost: two picks go 46ms to 94ms - still faster than the 148ms the single-total
path took before two-stage existed. C/D-tier share of the top 5 goes 28% to 32%.

## Stage-1 shortlisting was a straight loss (2026-09-05)

The re-tune above was chosen on the outcome gradient, variety, tier mix and speed.
It did not measure retrieval, on the reasoning that predicting what players pick
is not the goal. Not the goal and not measured are different things: the cost
went unreported. Measured now, held out, 1,200 season-41 ranked teams:

```
shortlist  coverage   hit@12/random  hit@3/random  MRR/random   gradient
   45        31.2%        0.40x          0.51x        0.47x    +4.1pp z=1.31
   90        73.3%        0.90x          1.05x        1.00x    +8.3pp z=2.70
   off      100.0%        1.10x          1.30x        1.25x    +7.1pp z=2.30
```

At 90, **a quarter of the picks players actually made were not in the list at
all** - stage 1 had already discarded them - and ranking quality sat at or below
chance as a direct consequence. That is a usability loss independent of any goal:
a character that never appears cannot be judged.

Turning stage 1 off costs 1.2pp of gradient, which is inside the noise (both
configs significant, heavily overlapping), and buys full coverage plus
above-chance ranking on all three retrieval metrics. Variety goes 95 to 110 of
115 variants. Tier mix barely moves - C-and-below 30% to 32% - and a two-pick
call costs 7ms more (88ms to 95ms).

So the two-stage idea survives, but only its second half: the value was never in
pre-filtering by individual merit, it was in ordering by composition alone.

`twoStageShortlist` is null rather than a number above the roster size, because
120 would behave identically today at 115 variants and then silently start
filtering again the week the roster grows past it.

## Still open

- (`relationship` firing 0% is not a defect - it is the user feedback loop, and
  there is no feedback data in a backtest.)
- The gradient is measured against `isTop3`, on ranked season-41 games only. It
  says teams that picked what we rank highly place better; it does not say our
  ranking caused it.
