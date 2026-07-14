# Winnow — Design

## Product principles

YouTube's feed optimizes for engagement: minutes watched, clicks, return visits. Winnow optimizes for **post-watch satisfaction** — videos the user actually wanted and feels enriched by. The overlap between those sets is real but loose, and the gap is where clickbait, engagement bait, and manufactured outrage live.

Non-negotiables (rejected features, forever):

- **No autoplay.** Nothing plays until the user presses play; nothing queues after.
- **No infinite scroll.** The feed is bounded and has a bottom, and says so.
- **No engagement-ranked anything.** Ordering is score tiers × recency.
- **Nothing is silently deleted.** Winnowed-out videos sit behind a one-click fold with the reason each was filtered — the curation must stay auditable or the user can't trust it.

## Architecture

Firefox extension (MV3). One Svelte SPA on an extension page (`feed.html`); an import-free background script opens/focuses it from the toolbar button. All data stays client-side.

```
toolbar button ─► feed.html (Svelte SPA, hash routes #/, #/watch/<id>, #/settings)
                    │
                    ├─ services/youtube/ytPage.ts ──── fetch(youtube.com, credentials:include)
                    │     └─ feedParser.ts             ytInitialData → Video[]   (subscriptions + home)
                    │     └─ transcripts.ts            watch page → caption track → excerpt
                    │
                    ├─ services/scoring/scorer.ts ──── batches → provider adapter → VideoScore
                    │     ├─ anthropicScorer.ts        claude-haiku-4-5, strict forced tool
                    │     ├─ openaiScorer.ts           gpt-4o-mini, strict json_schema
                    │     └─ demoScorer.ts             ?demo=1 offline stub
                    │
                    └─ stores/feedStore.ts ─────────── tiers (derived) → Feed/VideoCard/Watch
```

Why an extension and not a webapp: riding the user's logged-in session is the only way to (1) read the actual homepage recommendations (no public API exists), (2) fetch transcripts (CORS-blocked for webapps), and (3) avoid the entire Google OAuth apparatus. The cost is parsing YouTube's undocumented `ytInitialData` — see Fragility below.

Why direct scoring and not embeddings/RAG: at feed scale (~hundreds of items), an LLM judging each video against a nuanced free-text profile beats similarity search, which can't express exclusions ("less drama") or multi-dimensional taste. (Same conclusion movie-night reached — see `TWO_PHASE_SCORING.md` for the planned evolution.)

## Data acquisition

- `fetchFeedPage()` GETs `youtube.com/` and `/feed/subscriptions` with the session cookies (host permissions make extension fetches CORS-exempt), extracts the `var ytInitialData = {...}` blob, and detects signed-out state via ytcfg's `"LOGGED_IN":false`.
- `parseFeedPage()` deep-walks the tree collecting known leaf renderers — legacy `videoRenderer`/`gridVideoRenderer` and modern `lockupViewModel` (`contentType: LOCKUP_CONTENT_TYPE_VIDEO` only) — wherever they appear, so layout reshuffles don't break parsing; only leaf-shape changes do. Shorts, ads, and playlists are deliberately not matched. One malformed item never takes down the parse.
- Metadata is display text ("3 weeks ago", "2.1M views") parsed loosely in `format.ts`; `publishedAtApprox` is an approximation used only for sorting.
- Initial page data (~dozens of items per feed) bounds the MVP feed; InnerTube continuations are a documented later step.

### Fragility boundary

`feedParser.ts` is the one module allowed to know ytInitialData shapes. Rules: parse defensively, never throw, keep the recognized surface minimal, fixture-test every shape (real captured pages + synthetic logged-in shapes). Breakage renders as a "parser may need updating" warning, not a crash. Settings has a "Copy debug fixture" button that exports the last raw capture for new fixtures.

## Storage schema

All persistence via `src/lib/storage.ts` (browser.storage.local → localStorage → memory fallbacks). Keys namespaced and versioned:

| Key | Shape | Lifecycle |
|---|---|---|
| `winnow:settings:v1` | `{ provider, anthropicApiKey, openaiApiKey }` | persisted on change |
| `winnow:profile:v1` | `{ moreOf, lessOf, updatedAt }` | free-text interest profile |
| `winnow:videos:v1` | `{ fetchedAt, videos[] }` | merged+deduped subs+home, cap 300, TTL 30 min |
| `winnow:scores:v1` | `{ profileHash, scores: {videoId: {score, reason, clickbait, scoredAt, model}} }` | invalidated whole when profileHash mismatches |
| `winnow:watched:v1` | `{videoId: watchedAt}` | written on Watch open; pruned with videos |

`profileHash = fnv1a(moreOf, lessOf, PROMPT_VERSION, modelId)` — editing the profile, bumping the prompt, or swapping models cleanly re-scores everything (movie-night's versioned-cache pattern). Transcript excerpts are transient: fetched at scoring time, never persisted.

## Scoring pipeline

1. Cache-miss videos (per-item, so partial hits save calls) are enriched with transcript excerpts (cap 60/run, concurrency 2, best-effort).
2. Batches of 20 → provider adapter, concurrency 2; the feed fills in incrementally per batch and scores persist per batch (mid-run close loses nothing).
3. Structured output both providers: `{scores:[{videoId, score 0-100, reason ≤120 chars, clickbait}]}`. Scores clamped client-side (strict schemas reject numeric bounds); hallucinated videoIds dropped; unanswered ones land in the "unscored" bucket with a retry button.
4. Retry policy (house rule): one 2s-backoff retry on 429/5xx/network only; 4xx and malformed JSON fail fast (bugs, not weather); 401 aborts the run with a settings banner.

Tiers: **Top picks** (≥75, not clickbait) / **Worth a look** (50–74, clickbait-flagged high scorers demoted here) / **Winnowed out** (<50, folded). Score-collapse guard: when ≥95% of scored videos land in one tier, numeric badges hide and the UI suggests sharpening the profile.

Cost (claude-haiku-4-5): cold start ~200 videos ≈ $0.10 without transcripts, roughly 3–5× that with transcript excerpts; incremental daily refresh is cents. Profile edit ⇒ full re-score (accepted for MVP; see TWO_PHASE_SCORING.md for the fix).

## Privacy / threat model

- No winnow server, no telemetry, no third-party runtime scripts (policy, not preference).
- YouTube sees ordinary page fetches from the user's own browser session.
- The chosen AI provider receives video *metadata* (title/channel/stats) and transcript excerpts, plus the user's profile text — under the user's own API key.
- Keys live in extension storage; readable by anything with debugger access to the browser profile. Accepted for a no-backend personal tool; stated in the README.
- `anthropic-dangerous-direct-browser-access` / direct Bearer fetches are the established house pattern for BYO-key client-only apps.

## Verification

- Unit (free tier): pure `lib/` logic, parser fixtures, scorer orchestration with stub providers — no network, no keys. `npm test`.
- E2E (free tier): Playwright against the built page in demo mode. `npm run test:e2e`.
- Live checks are manual: load the temporary add-on, sign in to YouTube, refresh, eyeball parsed feed vs youtube.com, then add a real key and sanity-check curation quality.

## Post-MVP roadmap

1. **Two-phase scoring** (`TWO_PHASE_SCORING.md`) — profile edits become instant re-ranks.
2. InnerTube continuations for deeper feeds (needs SAPISIDHASH auth header).
3. 👍/👎 per-video feedback appended to the scoring prompt.
4. Watch-history-informed profile suggestions (suggested, never silent).
5. Takeover mode: redirect youtube.com's homepage to winnow.
6. Per-channel mute/boost weights; configurable tier thresholds and windows.
7. Chrome port (MV3 service_worker + webextension-polyfill).
8. Export/import of extension storage.
