# Two-Phase Scoring — the planned evolution

Status: **implemented 2026-07-15** as the default engine (`scoringStrategy` in Settings; direct single-pass kept behind the toggle for A/B until curation quality is confirmed by eyeball — migration step 5). Implementation deltas from the design below:

- The taxonomy gained **`claimOverreach`** (claims made vs. evidence shown in the transcript) as the BS axis — the product question "is this video BS?" is answered there, catching science-provocateur content whose packaging looks respectable. `emotional_tone`/`format` shipped as designed; `hype_signals` lists concrete observed techniques.
- Phase 1 reads the **full transcript** (20k-char budget via the ANDROID-player transcript route), not the 2k-char intro direct mode uses. Batches of 4 on fixed cheap models: `claude-haiku-4-5` / `gpt-5.4-nano`.
- Enrichment cache validity: transcript-backed digests are final per (model, prompt version); metadata-only digests stay provisional — every run retries the transcript and re-enriches only when the content hash changes.
- **Votes ride into the phase-2 translation** (not a design item): a vote changes the target input hash, so the next run re-translates and re-ranks the entire feed for ~$0.001 — closing the "existing scores predate recent votes" gap direct mode accepts.
- Code: `src/lib/digest.ts`, `src/lib/rubricScorer.ts` (pure), `src/services/scoring/enrichPrompt.ts`, `translatePrompt.ts`, `twoPhase.ts` (orchestrator). Live spec: `e2e/live/twoPhase.spec.ts`.
- **RANKER_VERSION 2 recalibration (2026-07-15, after the first real-feed run winnowed the entire feed):** binary constraints no longer swing 0↔1 like graded axes do. A topicsMore miss credits 0.35 (weak negative — a broad feed rarely matches any topic list, and full-weight zeros sank every video below the winnowed threshold); avoid-lists subtract only (a hit zeroes at full weight, a non-hit contributes no weight at all — credit-1 non-hits floated junk into "Worth a look", and a neutral-0.5 draft diluted on-profile matches below the Top threshold). `canonicalizeTarget` drops format `"other"` from `formatsAvoid` (it's `clampDigest`'s catch-all bucket, so avoiding it punished arbitrary videos) and caps avoid-lists at 3 items (a live nano run emitted 8 of 12 formats, including `tutorial` against a profile asking for lessons); the translator prompt (v2) forbids both plus quality-complaint "topics" ("clickbait" is an axis, not a topic). Verified at scale with `scripts/twophase-diag.ts` — 100 real videos through the production modules with live provider calls.

- **RANKER_VERSION 3 — qualified topics survive matching (2026-07-15, the gotham mis-ranking):** a low-tier comic chess video ranked top with the contradictory reason "on-profile: chess; avoided topic: chess". The translator had preserved the user's qualifiers ("comic chess" avoided, "top tier play" sought) but bidirectional-substring `topicMatch` collapsed them: avoid item "comic chess" fired on every digest tagged "chess", the seek/avoid hits cancelled in the weighted average, and quality axes floated the video up. Now: a profile item matches a digest topic iff every item token appears in that single topic (order/plural-insensitive, no union across tags); an avoid-topic hit caps the score at 45 (just under Worth-a-look — formats/tones stay uncapped as a feed-collapse guard) and leads the reason, which names the profile item, not the digest topic. `canonicalizeTarget` drops token-superset synonym spam. Translator prompt v3 keeps tier/level/style qualifiers and forbids emitting the bare parent tag for a restricted interest; enrichment prompt v2 asks for a qualified tier/style tag ("comic chess", "elite chess") alongside broad ones so those profile tags have something to match. Repro fixture: `src/services/youtube/fixtures/gotham-poor-ranking-capture.json.gz` (scrubbed via `scripts/scrub-capture.ts`) + `src/lib/fixtures/gotham-target.json`.

- **Vote-stale display + single-flight scoreFeed (2026-07-15, after UAT):** a vote changes the target input hash, so `expectedScoresHash` can't vouch for stored scores — but blanking the whole feed for one upvote (which the user hit on every watch → back navigation, since the feed remounts and re-runs `scoreFeed`) reads as a full recalc. `softScoresHashFor` (profile text + prompt/ranker versions + model, feedback excluded) is persisted with the scores; a soft match keeps them displayed while the one-call re-translation and local re-rank land in place. `scoreFeed` is also single-flight now (`lib/singleFlight.ts`) — concurrent remount calls coalesce instead of stacking pipelines.

Original design note follows.

The MVP scored directly: the LLM sees `(video metadata + profile)` and returns a score. That couples every score to the profile — editing the profile invalidates the whole cache and costs a full re-score (~$0.10 and a few minutes of batch calls).

The fix is the architecture movie-night uses (`~/dev/movie-night/backend/src/Services/` — reviewed 2026-07-13). It splits scoring into a profile-independent enrichment pass and a deterministic, instant ranking pass.

## The shape

```
Phase 1 — enrichment (LLM, once per video, cached forever)
  video metadata + transcript ──► structured taxonomy
    { clickbait_severity: 1-5, substance_density: 1-5, novelty: 1-5,
      production_effort: 1-5, intellectual_demand: ordinal,
      emotional_tone: enum, format: enum(tutorial|essay|vlog|news|reaction|…),
      topics: string[], hype_signals: string[] }

Phase 2 — profile translation (LLM, once per profile edit, O(1))
  moreOf/lessOf free text ──► structured target
    { fields the user actually constrained, each with value + importance 0-10 }

Rank — pure TypeScript, no LLM, runs in ms
  weighted average over constrained fields only; ordinal near-miss credit;
  empty target ⇒ all tie; reasons composed deterministically from the
  top-contributing fields.
```

## Payoffs

- **Profile edits re-rank instantly** for the cost of one small translation call (~$0.001), instead of a full re-score. This unlocks a live "tune your profile and watch the feed reorder" UX.
- Enrichment cache never invalidates on profile changes — keyed by `hash(video metadata) + ENRICHMENT_PROMPT_VERSION + model`.
- The ranker is a pure function: unit-testable with exact assertions, zero network, and its explanations can't hallucinate (they're composed from stored fields).

## Movie-night patterns to port (file references)

| Pattern | Movie-night source | Winnow target |
|---|---|---|
| Taxonomy enrichment prompt (controlled vocabulary, every enum's poles described) | `OpenAiMovieAnalysisService.php:23-60` | Phase 1 prompt |
| Free-text → structured target with per-field `importance`, emit-only-constrained-fields | `OpenAiRubricTargetTranslator.php:28-93` | Phase 2 prompt |
| Strict-mode "no optional fields" workaround: nullable + `canonicalize()` strips nulls | `OpenAiRubricTargetTranslator.php:137-146, 337-401` | both phases' schemas |
| Weighted-average-over-present-fields scorer; ordinal near-miss credit (`1 - dist/4`); empty target ⇒ tie | `RubricSoftScorer.php:70, 160-207` | `src/lib/rubricScorer.ts` (new, pure) |
| Deterministic reasons from top-3 contributing fields, `(field,value)→phrase` lookup | `ReasoningComposer.php:23-83` | reason composition |
| Content-hash skip-if-unchanged for incremental enrichment | `EmbeddingTextBuilder.hashOf()` + `MovieEmbeddingRunner:82-87` | enrichment cache key |
| Version-string cache invalidation ("bump when prompt or schema changes") | `Caching*.php:26-30` | `ENRICHMENT_PROMPT_VERSION`, `TRANSLATOR_PROMPT_VERSION` |
| Score-collapse guard (already ported in MVP) | `SemanticRecommendationService.php:251-255` | `src/lib/tiers.ts` ✓ |
| RRF rank fusion — only if a second ranking signal appears (recency prior, channel boost) | `RrfRanker.php` | not planned yet |

## What the MVP already prepared

- Score cache entries carry `model` and participate in a versioned hash — the cache shape extends to enrichment without migration pain.
- The `scoreBatch` adapter interface is strategy-agnostic; enrichment slots in behind `scorer.ts` without touching stores or UI.
- Tier bucketing, collapse detection, and sorting are already pure `lib/` functions with exact-assertion tests — the ranker joins them.

## Migration sketch

1. Add `enrichBatch` adapters (same provider files, new prompt + schema) and `winnow:enrichment:v1` storage keyed by content hash.
2. Add `translateProfile` (one call, cached by `fnv1a(moreOf+lessOf+version+model)`).
3. Add pure `rubricScorer.ts` + tests (port movie-night's exact-score unit tests: exact match ⇒ 1.0, distance-2 ⇒ 0.5, etc.).
4. Switch `scorer.ts` to: enrichment misses → LLM; then rank locally. Keep direct scoring behind a setting for A/B comparison during the transition.
5. Compare curation quality by eyeball on a real feed before removing direct scoring.

Open design question when we get there: taxonomy breadth. Movies are one domain; YouTube spans everything, so the taxonomy must stay generic (substance, bait, format, effort) with `topics[]` carrying the domain specifics — resist per-domain fields.
