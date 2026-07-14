# Winnow — Developer Guide

Working notes for picking up feature work in this repo (written agent-to-agent; humans welcome). `CLAUDE.md` carries the binding rules; `docs/DESIGN.md` carries the architecture and the *why*; this file carries the *how*: where things live, what breaks when you're careless, and the recipes for common changes.

## Orientation (read in this order)

1. `CLAUDE.md` — house rules (auto-loaded). TDD red/green, test tiers, commit discipline are not optional.
2. `docs/DESIGN.md` — architecture, data flow, storage schema registry, product non-negotiables.
3. This file.
4. `QUESTIONS.md` — open user-blocked items; check before building on an unverified seam.
5. `git log --oneline -15` — recent history is phase-structured and readable.

Status as of 2026-07-14: MVP confirmed working by the user against real YouTube data and real provider scoring. CI green on `main`.

## Module map

| Module | Owns | Touch it when |
|---|---|---|
| `src/lib/types.ts` | All shared types (`Video`, `VideoScore`, `Settings`, `Profile`…) | Any new data shape starts here |
| `src/lib/storage.ts` | `KEYS` registry + the ONLY storage chokepoint (webext → localStorage → memory) | New persisted key (also update DESIGN.md schema table) |
| `src/lib/tiers.ts` | `TIER_THRESHOLDS`, `bucketVideos`, `scoresCollapse` | Tier logic, sort order, collapse heuristic |
| `src/lib/format.ts` | Loose parsing of YouTube display text (durations, view counts, relative ages) | New display-text shape shows up |
| `src/lib/feedback.ts` | Pure vote bookkeeping: `applyVote` (toggle/replace/evict, cap 200), `recentExamples` for the prompt | Vote semantics |
| `src/lib/profileHash.ts` | fnv1a + score-cache invalidation hash | Rarely; hash inputs change via prompt.ts/model consts |
| `src/lib/router.ts` | Hash routes `#/`, `#/watch/<id>`, `#/settings` | New route |
| `src/lib/logger.ts` | `log.debug/info` (dev-only, tree-shaken) vs `log.warn/error` (ship) | Never add bare `console.*` |
| `src/services/youtube/pageExtract.ts` | Balanced-brace JSON-blob extraction (string/escape-aware) shared by ytPage and transcripts | Blob extraction breaks |
| `src/services/youtube/ytPage.ts` | Credentialed page fetch, `ytInitialData` + ytcfg extraction (`extractInnertubeConfig`), signed-out detection, `lastCaptures` (feeds the "Copy debug fixture" button) | Fetch/extraction issues |
| `src/services/youtube/feedParser.ts` | **The fragility boundary.** ytInitialData → `Video[]`; deep-walk over `videoRenderer`/`gridVideoRenderer`/`compactVideoRenderer` + `lockupViewModel` | YouTube changes shapes (see recipe 2) |
| `src/services/youtube/feedSource.ts` | `isDemoMode()`, demo fixtures, `loadFeeds()` merge/dedupe/cap (300), partial-failure warnings | Feed sources, demo behavior |
| `src/services/youtube/transcripts.ts` | Two-path excerpt fetch: timedtext json3 → InnerTube `get_transcript` fallback; null on ANY failure; `lastTranscriptCapture` debug capture | Transcript issues (in-browser verdict pending — QUESTIONS #4) |
| `src/services/scoring/prompt.ts` | `PROMPT_VERSION`, `BATCH_SIZE`, system prompt, shared JSON schema, user-message builder | Prompt changes (see recipe 7 — bump the version!) |
| `src/services/scoring/providerTypes.ts` | `ScoreBatchFn` interface, `ProviderError` taxonomy (`auth/rate/server/network/bad_request/bad_response`), `isRetryable` | New provider or error kind |
| `src/services/scoring/structuredCall.ts` | ONE structured-output call, either provider (forced tool / json_schema, headers, error taxonomy) | New call types (two-phase `translateProfile` goes here) |
| `src/services/scoring/{anthropic,openai,demo}Scorer.ts` | One `ScoreBatchFn` each (thin wrappers over structuredCall); model IDs are single reviewed constants | Provider/model changes |
| `src/services/scoring/scorer.ts` | `runScoring` (pure-ish orchestrator: batching, concurrency 2, retry, clamping, hallucinated-id filtering) + `scoreFeed` (store wiring, cache, transcript enrichment + coverage) | Scoring pipeline changes |
| `src/services/scoring/profileSuggest.ts` | Feedback → suggested moreOf/lessOf replacement (uncached structured call, demo stub, `MIN_VOTES_FOR_SUGGESTION`) | Suggestion quality/flow |
| `src/stores/settingsStore.ts` | Settings/profile stores, `isConfigured`, `applyKeyChange`, `missingConfig` | Settings semantics |
| `src/stores/feedStore.ts` | Videos/scores/watched/status stores, `tiers`/`collapsed` deriveds, `initFeed`/`refresh` (TTL 30 min), `transcriptCoverage`, pruning | Feed state machine |
| `src/stores/feedbackStore.ts` | Persisted votes (`toggleVote`); NEVER pruned with the video window | Vote persistence |
| `src/components/` | `App` (config gate + routes), `Feed` (tier sections), `VideoCard`, `ScoreBadge`, `Watch` (nocookie embed, no autoplay), `Settings`, `Onboarding` | UI |
| `src/background.ts` | Toolbar click → open/focus feed tab. Import-free; keep it that way | Almost never |
| `e2e/helpers/` | **All Playwright selectors** (house rule: specs use helpers only) | Any e2e work |
| `e2e/nonlive/`, `e2e/live/` | Demo-mode specs (CI) / real-provider specs (manual) | Recipes 6, 7 |

## Data flow (one refresh, end to end)

`Feed.svelte` onMount → `initFeed()` loads stored videos/watched (refetch if TTL-stale) → `refresh()` → `loadFeeds()` fetches `/feed/subscriptions` + `/` with session cookies via `ytPage.fetchFeedPage` → `feedParser.parseFeedPage` → merged/deduped `Video[]` into `feedStore.videos` + storage → `scoreFeed()` → cache check against `profileHash(profile, PROMPT_VERSION, modelId)` → misses enriched with transcripts (cap 60) → `runScoring` batches of 20 at concurrency 2 → scores persist per batch and stream into `feedStore.scores` → `tiers` derived re-buckets → UI fills in incrementally.

Demo mode (`?demo=1`) short-circuits: fixture videos, deterministic stub scorer, zero network. All nonlive e2e runs this path.

## Invariants and gotchas

Things that WILL bite if forgotten:

- **`PROMPT_VERSION` must be bumped for any change to the system prompt, schema, or user-message shape.** It's a profileHash input; forgetting it serves stale cached scores produced by a different prompt. Model ID constants are also hash inputs, so swapping a model self-invalidates.
- **Strict structured-output schemas reject numeric bounds and optional fields.** Scores are clamped client-side in `runScoring`; keep `additionalProperties: false`; for OpenAI strict mode every field is required (nullable-then-canonicalize if optionality is ever needed).
- **Retry taxonomy is a house rule:** one 2s retry on 429/5xx/network only; 4xx and malformed JSON fail fast (they're bugs); 401 aborts the run and banners.
- **`feedParser.ts` never throws.** A malformed item is skipped, never fatal. Every recognized shape has a fixture test. Don't widen the parse surface casually.
- **Store pattern (wolfechat):** init from storage, then `subscribe → persist`, gated by a `persist` flag so the initial default write doesn't clobber stored state before load. Copy `settingsStore.ts` when adding a store. Svelte 5 runes are for component-local state only; anything cross-component or persisted is a store.
- **`isConfigured` requires a key for the *selected* provider.** `applyKeyChange` re-points the provider at whichever key exists — keep that invariant or onboarding silently deadlocks (this was the first real-user bug).
- **Feedback is deliberately NOT a profileHash input.** Votes never invalidate cached scores; they ride in prompts for future cache misses, and "Re-score everything" is the feed-wide apply. Hashing feedback would full-re-score on every click. The voted video itself moves tiers instantly via `bucketVideos`' vote override (a user vote outranks the score AND the clickbait demotion).
- **Profile suggestions apply only on explicit user approval** ("suggested, never silent" — product rule). Apply routes through a normal `profile.update`, so the re-score falls out of the hash change.
- **Demo scorer is deterministic by design** (fnv1a of videoId). Nonlive e2e asserts exact tier placements (`abc123DEF45` → top, `live456GHI78` → winnowed). Changing its math means recomputing those expectations. Two deliberate e2e seams: ids prefixed `unvet` never get a demo score (exercises the awaiting-vetting fold), and `?slow=1` alongside `?demo=1` delays each demo batch so in-progress scoring states are observable.
- **Unvetted videos never render as browsable feed items.** While a run is active the feed shows a progress panel (`scoring-progress`); leftovers a run couldn't score sit behind the `unvetted-fold` (with Retry inside). Don't reintroduce an always-visible unscored section.
- **`log.debug/info` don't exist in production builds.** Debugging an installed extension needs `npm run build:dev`. Extension-page console is plain F12 on the winnow tab; background script via `about:debugging` → Inspect.
- **Live e2e seeds `winnow:videos:v1` with a fresh `fetchedAt`** so `initFeed` stays inside the TTL and never touches YouTube — that's how real-provider scoring is testable in a plain browser. Keys come from gitignored `.env.production`; never bake keys into a build (non-`VITE_`-prefixed vars can't leak into the bundle, keep it that way).
- **VM/host split:** build in the VM, load `~/dev/winnow/dist/manifest.json` on either side's Firefox via `about:debugging`; dev servers bind `0.0.0.0`; never run git from host and VM simultaneously.

## Recipes

1. **New pure logic** — RED unit test in `src/lib/*.test.ts` first, minimal GREEN, refactor. If the logic wants browser APIs, split: pure part in `lib/`, thin adapter in `services/`.
2. **Parser breakage / new YouTube shape** — get a real capture (user: Settings → "Copy debug fixture"), prune it to the minimal reproducing structure, drop it in `src/services/youtube/fixtures/`, write the failing fixture test (`should parse <shape>` / `should skip <junk>`), then extend `feedParser.ts`. Never fix the parser without a fixture locking the shape.
3. **New provider** — implement `ScoreBatchFn` in a new `<name>Scorer.ts` with a single model constant; throw `ProviderError` with the right `kind`; add a stub for unit tests; wire the adapter/model switch in `scorer.ts#scoreFeed`, the `Provider` union in `types.ts`, and the Settings radio. Add a live e2e case. The model constant joins the cache hash automatically.
4. **New setting** — field in `types.ts#Settings` + `DEFAULT_SETTINGS` (spread-merge on load keeps old stored blobs valid) + a control in `Settings.svelte` (`onchange` → `settings.update`). Persistence is free via the store subscription.
5. **New persisted key** — add to `KEYS` in `storage.ts` with a `:v1` suffix, register in DESIGN.md's schema table, access only through `storageGet/Set/Remove`. Schema change later = new `:v2` key + migration read, not silent shape drift.
6. **New UI behavior** — `data-testid` on the element, helper in `e2e/helpers/` (locator preference: `getByLabel` → `getByRole` → `data-testid` → CSS), spec in `e2e/nonlive/` through helpers only. If it needs scored videos, demo mode provides them deterministically.
7. **Prompt/scoring-quality change** — edit `prompt.ts`, **bump `PROMPT_VERSION`**, update scorer unit tests, then run `npm run test:e2e:live` (costs cents) to prove both providers still parse and the substance-vs-bait directional assertion holds.

## Verification loop

```bash
npm run check && npm test     # after every change — fast, free
npm run test:e2e              # builds + demo-mode Playwright; before commit
npm run test:e2e:live         # real provider calls; when touching prompt/providers/scorer
```

Manual smoke when the change affects real-YouTube behavior: `npm run build` (or `build:dev` for logs), reload the temporary add-on, refresh, compare against youtube.com. Before every commit: `git status` and account for every file. CI red on `main` is stop-the-line.

For pure UI iteration, skip the extension loop entirely: `npm run dev` → `http://<vm>:5173/feed.html?demo=1`.

## Debugging playbook

- **Feed empty or missing videos** → warnings banner under the refresh row shows per-feed parse failures; Settings → "Copy debug fixture" exports the raw `ytInitialData` that produced them (also in `ytPage.lastCaptures`).
- **Scoring silently does nothing** → `scoreFeed` no-ops when unconfigured: check provider/key pairing and profile text (`missingConfig` logic). In a `build:dev` build the console shows batch retries and the `transcripts: N/M fetched` line.
- **Inspect stored state** → extension: F12 on the winnow tab → `await browser.storage.local.get(null)`. Plain browser/e2e: `localStorage` with the same `winnow:*` keys.
- **Score cache confusion** → compare `winnow:scores:v1`.profileHash against `profileHash(profile, PROMPT_VERSION, model)`; a mismatch means the whole cache is intentionally dead. Settings → "Re-score everything" nukes it.
