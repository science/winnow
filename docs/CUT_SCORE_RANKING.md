# Cut-score ranking

Status: **shipped** (`RANKER_VERSION` 5, 2026-08-02). Two parts of the original
proposal changed under measurement — see §4 and §5. Tuning data and method are
kept here because the constants are only defensible with them.

## 1. The problem, measured

Diagnostic against the real gotham profile and the real 126-video capture
(`DIAG_PROFILE=gotham npx vite-node scripts/twophase-diag.ts 126 openai --capture`):

- **114 of 126 videos (90%) matched no `topicsMore` item at all.**
- **93 of 126 (74%) landed in "Worth a look"** — a large undifferentiated middle.
- **41% of Top picks were off-profile** (13 of 32), winning on production
  quality alone.

The feed was not sorting by "is this for me". It was sorting by "is this
competently produced".

## 2. Why

`rankVideo` takes a weighted average in which topic match is one contribution
among many. With the captured target (field weights 37, topic weight 7), topic
match carried **~16%** of the score, so an off-profile video with perfect
quality axes scored `(37·1 + 7·0.35)/44 = 89` — into Top picks without matching
a single stated interest. The arithmetic was working as designed; the design
traded relevance against quality and gave quality ~5× the weight.

## 3. The model

Two mechanisms, both inside `rankVideo`.

### Vetoes — garbage is disqualifying, not discountable

A video flagged `clickbait` is capped at `AVOID_TOPIC_SCORE_CAP` (45, just
under the Worth-a-look threshold), regardless of how well it matches.

The flag is the **pre-existing** `clickbaitSeverity >= 4 || claimOverreach >= 4`
(`CLICKBAIT_FLAG_THRESHOLD`). No new threshold was introduced: the same
condition that already demoted a video out of Top picks now caps it behind the
fold. Capped videos remain visible in the Winnowed fold with a reason naming
the veto — nothing is deleted.

### Topic weight floor — relevance outranks polish

`topicsMore` weight is floored at `TOPIC_WEIGHT_FLOOR_RATIO` (0.7) × the total
numeric-axis weight, applied **only when the profile actually names topics**.

Derived, not tuned. An off-profile video earns `TOPICS_MORE_MISS_CREDIT` (0.35)
on the topic contribution and can earn full credit everywhere else, so its
ceiling is `(W + 0.35F)/(W + F)`. Requiring that to stay under the Top-picks
threshold of 75 gives `F > 0.625W`; 0.7 clears it with margin.

The **ratio** form is the point: the ceiling works out to ~73 for any `W`, so
the guarantee survives the translator emitting a different importance mix next
run — which it does (§5).

> **Invariant:** production quality alone can carry a video to the top of
> Worth-a-look, never into Top picks. Only relevance does that.

`TOPICS_MORE_MISS_CREDIT` stays at 0.35. Raising topic weight while keeping the
miss credit is what makes this graduated rather than a collapse: off-profile
content moves out of Top picks *without* being winnowed.

## 4. What changed from the proposal: `substanceDensity` is not veto-eligible

The proposal listed three integrity axes. Measurement rejected one.

Vetoing `substanceDensity <= 2` **winnowed 46% of the capture** (58 of 126),
and inspection showed why — it was catching:

```
cb=1 ov=1 sub=1  Ora Cogan - Full Performance (Live on KEXP)
cb=1 ov=1 sub=1  Cardinals - She Makes Me Real (Live on KEXP)
cb=1 ov=1 sub=2  Stewart Copeland Plays "King Of Pain" | The Police
cb=1 ov=1 sub=2  Dune: Part Three | Official Trailer
```

**`substanceDensity` is genre-correlated, not garbage-correlated.** A live
music session is honest, well made, and legitimately scores 1 — it has no
informational substance because it is not informational content. Vetoing on it
would encode "informational content is the only good content" as universal
policy, and would fire on music, performance, and film for every user.

Off-profile content is the topic axis's job, and the floor already handles it
correctly: those videos land in Worth-a-look, not winnowed.

Veto rates on the capture:

| rule | vetoed | share | flip rate between passes |
|---|---|---|---|
| `cb>=4 or ov>=4 or sub<=2` | 50 | 40% | 11% |
| `cb>=4 or ov>=4` (**shipped**) | 7 | 6% | 4% |
| a 5, or two axes ≥4 | 9 | 7% | 5% |

The shipped rule catches the genuine offenders — *"The Internet Is
Dead…And Nobody Cares"* (cb 4/ov 4), *"The Quantum Experiment That Breaks
Time"* (ov 4), *"Harry Kane is a Top 1% Chess Player"* (ov 4) — while sparing
KEXP sessions, stand-up compilations, and trailers.

The proposal's corroboration rule ("a 5, or two ≥4") was designed to resist
cheap-model jitter. It proved unnecessary once `substanceDensity` was dropped:
a single-axis rule on the two integrity axes vetoes only 6%, so noise cannot
produce mass vetoes. Corroboration was rejected as complexity buying nothing.

### Axis stability (2 independent enrichment passes, same 126 videos)

| axis | exact | ±1 | ±2+ |
|---|---|---|---|
| substanceDensity | 77% | 23% | 0% |
| clickbaitSeverity | 69% | 31% | 0% |
| claimOverreach | 74% | 26% | 0% |
| intellectualDemand | 82% | 18% | 0% |
| productionEffort | 67% | 33% | 0% |
| novelty | 71% | 29% | 0% |

No axis ever moved by 2+. Note this bounds re-scoring churn, not correctness:
digests are cached per video, so in normal use a video is enriched once and its
digest is fixed until a prompt-version bump.

## 5. Robustness to translator drift

Two diagnostic runs produced **materially different targets from the same
profile, model, and input**: run 2 dropped `substanceDensity` and
`intellectualDemand` entirely, dropped `science`, invented
`computer engineering` (against a profile that rejects computer science), and
produced 41 top picks against run 1's 7.

Temperature cannot be pinned — both model families reject the parameter
(`structuredCall.ts:53,92`). This variance is inherent.

This is why both mechanisms are **fixed policy rather than LLM-assigned
weight**: when run 2 dropped `substanceDensity`, nothing was left to penalize
filler. The veto does not depend on the translator emitting the axis, and the
floor is a ratio so it adapts to whatever weights arrive.

Exposure is bounded but real: the target is cached by
`targetInputHashFor(profile, feedback, model)`, so it re-rolls whenever the
profile is edited **or a vote is cast** — every vote re-rolls the whole target.

**Open companion fix:** require the translator's `fields` to be non-null with
`importance: 0` meaning "not expressed", instead of allowing `null`. Forcing an
explicit judgment per axis should reduce silent drop-outs. Not built.

## 6. Result on the capture

| | before | after |
|---|---|---|
| Top picks | 32 | 22 |
| **off-profile share of Top picks** | **41% (13)** | **0% (0)** |
| Worth a look | 79 | 82 |
| Winnowed | 15 | 22 |

Raising topic weight *beyond* the floor changes nothing until +40, where it
starts winnowing on-profile content — confirming the floor sits at the right
point rather than merely a workable one.

## 7. Method (reusable)

1. `twophase-diag.ts --dump=<path>` — one paid enrichment pass, persists digests
   plus the target that ranked them.
2. `scripts/rank-sweep.ts <dump>` — pure, offline, deterministic: tier
   distribution and off-profile share for the live ranker, plus the effect of
   further topic weight. No API cost per candidate, so constants are chosen
   from a table rather than intuited (the July 2026 feed-collapse came from
   intuiting them).
3. Two dumps from separate passes give the axis-stability table.

`scripts/rank-sweep.ts` imports the real `rankVideo` and mirrors `tiers.ts`
bucketing — a reimplementation could drift and describe a feed the user will
never see.

## 8. Guarantees pinned by tests

- An off-profile video stays out of Top picks however well produced.
- An on-profile mediocre video outranks an off-profile polished one.
- A vetoed video stays capped despite a subscribed-channel boost — subscribing
  must not launder a creator's junk past a quality veto.
- Low-substance honest content (live music) is **not** vetoed.
- No topic floor when the profile names no topics.
