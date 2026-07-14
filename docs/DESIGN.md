# Winnow — Design

## Product principles

YouTube's feed optimizes for engagement: minutes watched, clicks, return visits. Winnow optimizes for **post-watch satisfaction** — videos the user actually wanted and feels enriched by. The overlap between those sets is real but loose, and the gap is where clickbait, engagement bait, and manufactured outrage live.

Non-negotiables (rejected features, forever):

- **No autoplay-next.** The video the user clicked starts playing on open (start-on-open is intent, not a dark pattern); nothing ever queues or plays after it ends.
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
                    │     ├─ openaiScorer.ts           gpt-5.4-mini, strict json_schema
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
| `winnow:settings:v1` | `{ provider, anthropicApiKey, openaiApiKey, anthropicModel, openaiModel }` | persisted on change; missing model fields fill from defaults on load |
| `winnow:profile:v1` | `{ moreOf, lessOf, updatedAt }` | free-text interest profile |
| `winnow:videos:v1` | `{ fetchedAt, videos[] }` | merged+deduped subs+home, cap 300, TTL 30 min |
| `winnow:scores:v1` | `{ profileHash, scores: {videoId: {score, reason, clickbait, scoredAt, model}} }` | invalidated whole when profileHash mismatches |
| `winnow:watched:v1` | `{videoId: watchedAt}` | written on Watch open; pruned with videos |
| `winnow:transcripts:v1` | `{videoId: {excerpt, source: "timedtext"\|"innertube", fetchedAt}}` | successes only; pruned with videos (voted ids kept) |
| `winnow:feedback:v1` | `{videoId: FeedbackEntry}` — vote + votedAt + display-field snapshot + score-at-vote | cap 200 (oldest evicted); never pruned with videos |
| `winnow:models:v1` | `{ anthropic: string[], openai: string[], fetchedAt }` — model catalog for the Settings picker | refreshed only on explicit "Refresh model list"; picker works offline from this |

`profileHash = fnv1a(moreOf, lessOf, PROMPT_VERSION, modelId)` — editing the profile, bumping the prompt, or swapping models cleanly re-scores everything (movie-night's versioned-cache pattern). Transcript excerpts are cached by videoId (bounded by the 300-video window via pruning) so re-scores and feedback analysis don't re-fetch watch pages; fetch failures are never cached, staying retryable.

## Scoring pipeline

1. Cache-miss videos (per-item, so partial hits save calls) are enriched with transcript excerpts (cap 60/run, concurrency 2, best-effort).
2. Batches of 20 → provider adapter, concurrency 2; the feed fills in incrementally per batch and scores persist per batch (mid-run close loses nothing).
3. Structured output both providers: `{scores:[{videoId, score 0-100, reason ≤120 chars, clickbait}]}`. Scores clamped client-side (strict schemas reject numeric bounds); hallucinated videoIds dropped; unanswered ones land in the "unscored" bucket with a retry button.
4. Retry policy (house rule): one 2s-backoff retry on 429/5xx/network only; 4xx and malformed JSON fail fast (bugs, not weather); 401 aborts the run with a settings banner.

Tiers: **Top picks** (≥75, not clickbait) / **Worth a look** (50–74, clickbait-flagged high scorers demoted here) / **Winnowed out** (<50, folded). Score-collapse guard: when ≥95% of scored videos land in one tier, numeric badges hide and the UI suggests sharpening the profile.

### Feedback (Good pick / Not for me)

Per-video votes have two effects. **Instant and local:** the voted video moves tiers deterministically — a downvote winnows it regardless of score; an upvote pins it to the head of Top picks, outranking even the clickbait demotion (an explicit user verdict IS vetting). **Future scoring:** the most recent votes per direction (`FEEDBACK_PROMPT_CAP`) ride along in every scoring prompt as taste examples. Feedback is deliberately **not** a profileHash input: a vote never invalidates cached scores (a per-vote full re-score would cost real money per click and fight the two-phase evolution — prompt-append feedback is an acknowledged bridge, see `TWO_PHASE_SCORING.md`). New votes therefore influence only future cache misses; **"Re-score everything" in Settings is the feed-wide apply**. The accepted tradeoff: existing scores may predate recent votes.

Cost (claude-haiku-4-5): cold start ~200 videos ≈ $0.10 without transcripts, roughly 3–5× that with transcript excerpts; incremental daily refresh is cents. Profile edit ⇒ full re-score (accepted for MVP; see TWO_PHASE_SCORING.md for the fix).

## Privacy / threat model

- No winnow server, no telemetry, no third-party runtime scripts (policy, not preference).
- YouTube sees ordinary page fetches from the user's own browser session.
- The chosen AI provider receives video *metadata* (title/channel/stats) and transcript excerpts, plus the user's profile text — under the user's own API key.
- Keys live in extension storage; readable by anything with debugger access to the browser profile. Accepted for a no-backend personal tool; stated in the README.
- The `cookies` permission exists solely to read the youtube.com `SAPISID` cookie, which signs InnerTube transcript requests (`Authorization: SAPISIDHASH`, `src/lib/sapisidHash.ts`). The cookie value never leaves the browser — only its SHA-1 hash travels, and only to youtube.com.
- `anthropic-dangerous-direct-browser-access` / direct Bearer fetches are the established house pattern for BYO-key client-only apps.

## Verification

- Unit (free tier): pure `lib/` logic, parser fixtures, scorer orchestration with stub providers — no network, no keys. `npm test`.
- E2E (free tier): Playwright against the built page in demo mode. `npm run test:e2e`.
- E2E (live tier, manual): real Anthropic/OpenAI calls against seeded fixture videos — asserts score shape and that on-profile substance outscores bait. `npm run test:e2e:live`, keys from gitignored `.env.production`; skips when keys are absent.
- Real-YouTube checks stay manual: load the temporary add-on, sign in to YouTube, refresh, eyeball parsed feed vs youtube.com and curation quality. See `DEVELOPMENT.md` for the full loop and debugging playbook.

## Post-MVP roadmap

1. **Two-phase scoring** (`TWO_PHASE_SCORING.md`) — profile edits become instant re-ranks.
2. InnerTube continuations for deeper feeds (needs SAPISIDHASH auth header).
3. ~~Per-video feedback appended to the scoring prompt~~ — **shipped** (Good pick / Not for me; see Feedback section above).
4. ~~Feedback-informed profile suggestions (suggested, never silent)~~ — **shipped** (Settings → "Suggest profile updates from my feedback"). Watch-history-informed suggestions remain future work.
5. Takeover mode: redirect youtube.com's homepage to winnow.
6. Per-channel mute/boost weights; configurable tier thresholds and windows.
7. Chrome port (MV3 service_worker + webextension-polyfill).
8. Export/import of extension storage.
