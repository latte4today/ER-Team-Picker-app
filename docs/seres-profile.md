# Seres profile review (2026-10-12)

## Evidence

- [Official 12.5 release skills](https://playeternalreturn.com/posts/news/3867): two-handed sword; P applies skill damage from basic attacks; Q supplies a short dash/self shield and a directional stun; W displaces and slows nearby enemies; E redirects ally damage and heals Seres; R shields nearby allies while Seres is unstoppable.
- [Official 12.5b hotfix](https://playeternalreturn.com/posts/news/3882): E redirection reduced to 8–12% (+bonus HP scaling), 12–16% for Lucia, ordinary target healing reduced to 20%, cooldown increased; R shield per tick changed to 24/36/48 (+5% skill amplification +1.2% max HP). Ranked availability confirmed. The classifications below depend on the mechanics, not the launch coefficients.

## App classifications (curated, not official ratings)

- Role: frontline tank, including the actual `seres:two_handed_sword` variant. The variant must be in `tankVariantIds`, otherwise the shared factory converts the base frontline role to bruiser.
- Damage: skill. P, Q and W deal skill damage despite P being triggered by basic attacks. No fabricated average damage or empirical tier/core statistics are added.
- Tags: peel, shield, utility, cc, durable, mobility. W can disengage divers; E protects an ally; R is a team shield. Self healing is not tagged as ally healing, and self movement speed is not tagged as an ally speed boost.
- Initiate strength: 2/5; the variant gains the shared initiate tag. Q only dashes 2.5m and E needs an ally, so she is a `guardSometimesEngage` protector rather than a dedicated first-engage diver.
- CC: two non-target casts, one narrow (Q2), one medium (W). W's knockback and slow count once. Ally-targeted E and unstoppable/shield R are not enemy CC.
- Overview metrics: difficulty 3, damage 2, defense 5, crowd control 3, mobility 3, utility 5. These are app estimates on its existing 1–5 scale, explicitly attributed through `WIKI_METRICS_SOURCE.overrides.seres`. Difficulty reflects directional Q2, positioning for W/R, E target selection and the low-health redirection cutoff. Defense/utility reflect damage sharing and team shields; damage is lower than a damage-focused bruiser. They are not asserted to be official or NamuWiki ratings.
- Lucia's E interaction is documented but no unsupported fixed pair-synergy bonus is invented.
- Union's two-backline plan prioritizes damage sharing, shielding and peeling before the generic engage guidance. The plan is localized in all five languages.

## Statistics

Code 91 maps to Seres through the shared fallback map used by the official statistics builder, ML exporter and empirical spectrum report. Regression fixtures exercise actual builder/exporter paths. Historical `unknownChar` counts in generated statistics cannot be corrected by editing the count: regenerate from the raw official archive after merging. Existing data and empirical core preferences remain intact.

## Release validation

Run `node tools/test_seres.mjs`, the existing regression scripts and the recommendation snapshot. The snapshot adds Seres and Lucia pick contexts across all five tiers; inspect any changes before refreshing it. Verify browser search, localized names, portrait loading, recommendations, core selection and union selection on the production commit.

The existing `test_fullteam.mjs` called the removed `recommendFullTeam` export with an invalid weapon. It now checks reciprocal evaluations through the current API, order invariance and duplicate exclusion. Browser testing also exposed a tutorial dismissal race: queued animation frames could use a cleared highlight target. The refresh callbacks now stop after dismissal/step change and the positioning function tolerates a missing avoidance target.
