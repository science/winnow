# Cut-score ranking (planned)

Status: **proposed**, not implemented. Constants below are hypotheses to be
validated by the measurement protocol in §6 before anything ships.

## 1. The problem, measured

Diagnostic run 2026-08-01/02, real gotham profile against the real 126-video
capture (`npx vite-node scripts/twophase-diag.ts 126 openai --capture`,
`DIAG_PROFILE=gotham`):

- **114 of 126 videos (90%) matched no `topicsMore` item at all.**
- **93 of 126 (74%) landed in "Worth a look"** — a large undifferentiated middle.
- On the second run, **29 of 41 top picks (71%) were off-profile.**

The feed is not sorting by "is this for me". It is sorting by "is this
competently produced", and off-profile-but-polished content wins.

## 2. Why the current model produces this

`rankVideo` takes a weighted average over commensurable credits, where topic
match is one contribution among many:

| run | field weights | topicsMore weight | topic share |
|---|---|---|---|
| 1 | substance 7, clickbait 8, overreach 8, demand 7 = **30** | **7** | 19% |
| 2 | clickbait 9, overreach 8 = **17** | **8** | 32% |

An off-profile video with perfect quality axes scores
`(30·1 + 7·0.35)/37 = 88` — comfortably into Top picks without matching a
single stated interest. That is not a bug in the arithmetic; it is the
arithmetic working as designed. Relevance and quality are being traded off
against each other, and quality has 4× the weight.

## 3. The model

Two stages, replacing one weighted average.

### Stage 1 — vetoes (fixed policy, profile-independent)

Garbage is **disqualifying, not discountable**. Above an intensity threshold a
video is capped at `AVOID_TOPIC_SCORE_CAP` (45, just under the Worth-a-look
threshold of 50) regardless of how well it matches.

This reuses the existing avoid-topic cap mechanism rather than inventing a
second one, and it preserves the product principle: capped videos land in the
**Winnowed** fold with a reason, still one click away. Nothing is deleted.

**Veto-eligible axes are integrity axes only** — those with a fixed bad
direction, independent of taste:

| axis | bad direction | rationale |
|---|---|---|
| `clickbaitSeverity` | high | packaging lies about content |
| `claimOverreach` | high | claims beyond the evidence |
| `substanceDensity` | low | filler |

**Not veto-eligible — preference axes**, where the desired value is a matter
of taste and the profile supplies the target: `intellectualDemand`,
`productionEffort`, `novelty`. Low intellectual demand is not garbage; someone
may legitimately want background watching. Vetoing on these would encode one
user's taste as a universal quality bar.

### Stage 2 — weighted score below the cuts

For everything that survives Stage 1:

- **Topic relevance gets a weight floor**, so subject match dominates instead
  of being a minor term.
- **Integrity axes contribute at reduced weight** — they have already done
  their main job as vetoes; sub-threshold variation should nudge, not decide.
- **Preference axes unchanged.**

`TOPICS_MORE_MISS_CREDIT = 0.35` stays. Raising topic weight while keeping the
miss credit is what makes this graduated rather than a collapse: with a floor
of 30 against run-1's field weights, an off-profile polished video moves
`88 → (30·1 + 30·0.35)/60 = 68` — out of Top picks, into Worth a look, **not**
winnowed. An on-profile mediocre video moves to
`(30·0.5 + 30·1)/60 = 75` — into Top picks. That inversion is the entire goal.

## 4. Proposed constants (hypotheses)

| constant | proposed | note |
|---|---|---|
| veto rule | `any integrity axis at 5`, **or** `two axes at ≥4` | single-axis 4s are the noisiest region; requiring corroboration resists cheap-model jitter |
| `substanceDensity` veto | `≤2` (as the "at 5" equivalent: 1), `≤2` counts toward the two-axis rule | inverted direction |
| topic weight floor | `≥ Σ(other weights)` | makes relevance ≥50% of the score regardless of what the translator emits |
| integrity sub-threshold weight | `×0.5` of translated importance | |

`CLICKBAIT_FLAG_THRESHOLD = 4` already exists and already demotes out of Top
picks. This proposal promotes that demotion to a veto for the severe end while
leaving the flag intact for the moderate end.

## 5. A second benefit: robustness to translator drift

The two diagnostic runs produced **materially different targets from the same
profile, model, and input**:

- run 2 dropped `substanceDensity` and `intellectualDemand` entirely;
- run 2 dropped `science` (a headline subject) and invented
  `computer engineering`, while the profile explicitly rejects computer science;
- resulting top-pick counts: **7 vs 41**.

Temperature cannot be pinned — both model families reject the parameter
(`structuredCall.ts:53,92`). So this variance is inherent, not tunable away.

Any design that leans on LLM-assigned importances for quality control is
building on sand: when run 2 dropped `substanceDensity`, nothing was left to
penalize filler. **Fixed cut scores do not depend on the translator emitting
the axis at all.** That is an independent argument for this model beyond the
relevance problem it was proposed to solve.

Exposure is bounded but real: the target is cached by
`targetInputHashFor(profile, feedback, model)`, so it re-rolls whenever the
profile is edited **or a vote is cast** — every vote re-rolls the whole target
and can reshuffle the feed for reasons unrelated to the vote.

**Companion fix, separable:** make the `fields` schema require non-null
objects with `importance: 0` meaning "not expressed", instead of allowing
`null`. Forcing an explicit judgment per axis should reduce silent drop-outs.
Worth doing regardless of whether cut scores ship.

## 6. Measurement protocol (do this before choosing constants)

Choosing thresholds by intuition is how the July feed-collapse happened. The
tuning must be offline, deterministic, and repeatable:

1. **Dump digests once.** Add `--dump-digests <path>` to `twophase-diag.ts`,
   writing the enriched digests for the capture. One paid enrichment pass.
2. **Sweep offline.** A pure script/test loads the dumped digests, holds one
   target fixed, and sweeps veto thresholds × topic-weight floors, printing
   the resulting tier distribution for each cell. Zero API cost, fully
   deterministic, and the choice of constants becomes auditable.
3. **Axis stability check.** Enrich the same subset twice and measure how often
   each axis moves by ≥1 and how often a veto decision flips. **If
   `clickbaitSeverity` flips across the 4 boundary often, the single-axis veto
   is unsafe and only the two-axis rule survives.** This is the measurement
   that decides §4's veto rule.
4. **Feed-collapse guard.** No candidate ships if it winnows an implausible
   fraction of the capture. `scoresCollapse` (≥95% in one tier) is a symptom
   detector, not prevention — the sweep table is the prevention.

## 7. Risks

- **Over-winnowing.** The July 2026 collapse came from harsh scoring
  (`TOPICS_MORE_MISS_CREDIT` at 0 sank entire feeds). Mitigated by §6 step 2
  and by keeping the miss credit at 0.35.
- **Noisy cheap-model axes.** A hard threshold turns a 3-vs-4 judgment by
  `gpt-5.4-nano` into a binary outcome. Mitigated by the two-axis
  corroboration rule; §6 step 3 decides whether that is sufficient.
- **Auditability.** A vetoed video must say so. Reason strings need to name
  the veto ("winnowed: bait-style packaging"), consistent with how
  avoid-topic caps already lead their reason.

## 8. Rollout

- Bump `RANKER_VERSION` (ranking semantics change ⇒ clean cache invalidation).
- Vetoes outrank `applyChannelBoost`, exactly as avoid-topic caps already do —
  subscribing to a creator must not launder their junk past a quality veto.
- TDD per house rules; the guarantee tests are "a vetoed video stays winnowed
  despite a channel boost" and "an on-profile mediocre video outranks an
  off-profile polished one".

## 9. Open decisions

1. **Veto severity** — cap at 45 (Winnowed fold, visible, auditable) vs a
   harder exclusion. Recommendation: cap, consistent with avoid-topic and with
   the never-delete principle.
2. **User-tunable thresholds in Settings?** Recommendation: no, initially.
   MVP-first; do not add config for hypothetical needs.
3. **Does the topic-weight floor apply when the profile names no topics?**
   Recommendation: no — with an empty `topicsMore` the floor would amplify a
   constraint that does not exist.
