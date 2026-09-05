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

## officialV2 was sitting at zero weight for no reason (2026-09-05)

`officialV2Weight` and `officialMatchWeight` were computed on every evaluation and
shown in the recommendation reasons, but the lean total multiplied both by zero.
The note beside them said they were the two best discriminators of a winning
team's pick (AUC 0.599 and 0.546, against 0.546 for the total itself), which had
never been acted on.

Swept on the tuning block, validated on the untouched held-out 1,200 teams:

```
officialV2  officialMatch    gradient      hit@12  hit@3   MRR   variety
   0.0           0.0       +9.6pp z=2.99    1.04x  1.23x  1.21x    112
   0.4           0.0      +10.7pp z=3.33    1.05x  1.21x  1.21x    112
   1.5           0.0      +10.5pp z=3.31    1.07x  1.13x  1.21x    109
   0.0           0.3      +10.2pp z=3.18    1.04x  1.18x  1.21x    111
```

Shipped at 0.4. 1.5 buys the same gradient but costs hit@3 (1.23x to 1.13x) and
variety (112 to 109) - which is what re-adding individual strength to a
composition-only ordering looks like, and is exactly what the shortlist removal
above was for. 0.4 moves the gradient and leaves every other metric alone.

The improvement is modest and its own significance is not established - what is
established is that the direction reproduced on both blocks (+0.8pp tuning,
+1.1pp held out) at no measurable cost. officialMatch stays 0; on top of 0.4 it
bought nothing.

## Two-stage made the recommended trait score-irrelevant (found 2026-09-05)

Noticed from the UI, not from a test: three Priya rows in a row, all 79. Checked
it, and on all 210 multi-core builds every core for a build scores identically, to
four decimals.

The core reaches the total only through `officialCoreFit` and
`officialCoreRoleShift` inside `leanHeuristicSum`, and stage 2 sets
`heuristicWeight` to 0. So shipping two-stage silently switched the trait off as a
scoring input, while the UI kept presenting a "recommended core".

```
                                  multi-core builds  identical  max spread
two-stage on  (heuristicWeight 0)        210            210       0.0000
two-stage off (single total)             210            121       1.1000
two-stage on  + heuristicWeight 0.12     210            155       0.4000
```

Two fixes were tried and both rejected on held-out data.

Restoring the whole heuristic bundle costs gradient (tuning block: +5.6pp at 0
falling to +3.1pp at 0.12) while raising retrieval - the same trade the structural
terms always make.

Giving the core terms their own weight, away from that bundle, looked free on the
tuning block: gradient flat at 5.3-6.0pp while retrieval climbed. Held out it was
not free, and it was monotone:

```
coreFitWeight   gradient        hit@12  hit@3   MRR
    0.00      +10.7pp z=3.33     1.05x  1.21x  1.21x
    0.25       +8.4pp z=2.74     1.16x  1.26x  1.29x
    1.00       +6.3pp z=2.25     1.39x  1.70x  1.48x
    1.60       +5.9pp z=2.19     1.53x  1.78x  1.56x
```

Which core a character runs predicts what people pick and does not predict how the
pick places. `coreFitWeight` stays 0.

But "the score cannot rank cores" is not "the core does not matter".

The first version of this measured over every core in the trait build table and
reported a 4.2pp median spread with the most-played core best only 35% of the
time. That was wrong, and a user caught it: it counted cores the app never offers.
Fenrir/glove has seventeen core rows, and the "best" one it found was 빛의 수호 at
236 games - 0.3% of the build - against 취약 at 38,930. candidateCoreOptions
already filters to the top core plus anything holding 12% of its games, so those
rows never reach a user.

Restricted to what the app actually offers:

```
                        every core in the table    cores the app offers
builds with a choice              96                        54
median top-3 spread             4.2pp                     1.5pp
max spread                     13.4pp                     6.8pp
most-played is best            35%                        52%
```

Smaller, and still worth acting on - the disagreements sit on large samples:

```
lucia:sniper_rifle   흡혈마 33.5% (49,670)  →  벽력 36.5% (11,395)   z=6.1
fenrir:glove         취약   36.4% (38,930)  →  응징 38.6% (24,945)   z=5.6
leon:tonfa           벽력   40.2% (3,978)   →  헌신 46.7% (1,372)    z=4.2
nicky:glove          금강   37.5% (67,445)  →  치유 드론 39.5% (8,187) z=3.5
```

The most-played core is the default, and a challenger replaces it only when it
clears a two-proportion z-test at 2. The first attempt shrank toward the build's
average with a fixed alpha of 400, which let a 236-game core outrank a 38,930-game
one; a test that reports its own confidence does not have that failure mode. Both
numbers are shown, pick rate and top-3 rate, because they disagree on half the
builds and showing only one makes the other half look arbitrary.

### The core changes what the character is, and the model already knows

The same character is a different thing on different cores. The model encodes this
and then throws it away. Of the 53 builds offering a choice, 26 change tags with
the core and 28 fire a role override; the playstyle axes move by 0.36 (damage) and
0.38 (durability) at the median, up to 0.98.

```
fiora:spear
  증폭 드론   front=medium  tags=[dive,duel,durable,peel,sustained]
  흡혈마      front=high    tags=[dive,duel,sustained]
  빛의 수호   front=high    tags=[dive,duel,focus,sustained]  damage=skill
```

And the fit terms respond to it, per team:

```
fiora:spear against [rozzi:pistol, nadine:bow]
  증폭 드론   teamShape 0.712  coverage 1.396
  흡혈마      teamShape 0.118  coverage 0.496
  빛의 수호   teamShape 0.118  coverage 1.396
  ... total, all three: -0.7720
```

Identical totals, because stage 2 zeroes fitWeight. Ranking characters by fit was
measured and rejected; choosing between one build's cores is a different question
and is not part of what was measured, so the fit term is used there. Cores
significantly worse on top-3 rate are dropped, the most-played of what remains is
the default, and fit displaces it only by a margin of 0.05 - leanFitTerm clamps at
0.95 and near-ties at the ceiling would otherwise flip the display on 0.003. It
fires on about 7% of builds and the answer moves with the team: 6 flips against
one frontline pick, 7 against two, 0 against a lone assassin.

So the display was corrected instead of the score. The row's core is labelled as
the most-played trait, which is what it has always actually been - core options are
ordered by games, not by any score - and the alternates show share of games rather
than a score that would be identical across all of them.

## Placing and winning are different properties (2026-09-06)

Everything above optimises and reports on top-3 rate. That hides a real
distinction: a composition that avoids elimination is not the same as one that
converts when its items come together.

Across the 115 builds with 3,000+ games the two rates correlate at **r=0.617**.

```
                        top-3 rate        win rate
charlotte:arcana      35.0% (114th)     14.8% (14th)
theodore:sniper_rifle 37.6% (105th)     14.6% (21st)
daniel:dagger         42.4%  (11th)     12.2% (92nd)
alex:flex             43.6%   (3rd)     13.1% (71st)
```

Charlotte is second-worst in the pool at reaching top 3 and 14th at winning.
Daniel is the reverse. Ranking either one by top-3 rate alone describes it wrongly.

It shows up in cores too: of the 54 builds offering a core choice, **12 (22%)**
have a different best core for top-3 rate than for win rate.

```
fiora:spear   top-3 best 증폭 드론 39.6%/13.6%   win best 빛의 수호 39.6%/16.5%
isol:pistol   top-3 best 폭발 선인장 45.2%/13.7%  win best 헌신 42.4%/14.5%
```

Same top-3 rate for Fiora's two cores, three points of win rate between them.

Labelled rather than scored, for now. win/top-3 averages 0.333 across the pool
with the middle half between 0.318 and 0.350, so a build more than 5% off the pool
ratio - roughly the quartile line - is tagged 고점형 or 안정형, and both rates are
shown on the core chips. Choosing which one to *optimise* is a different change:
the outcome gradient is measured against isTop3 throughout, and switching the
objective would invalidate every number in this file.

## Still open

- (`relationship` firing 0% is not a defect - it is the user feedback loop, and
  there is no feedback data in a backtest.)
- The gradient is measured against `isTop3`, on ranked season-41 games only. It
  says teams that picked what we rank highly place better; it does not say our
  ranking caused it.
