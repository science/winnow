# Questions for the user

Accumulated during autonomous work sessions. Answer at leisure; nothing here blocks work.

All items from the 2026-07-13/14 sessions (repo visibility, signing, fixtures, transcripts, models/SDKs, feedback, icon, CI, error 153, autoplay, e2e harness) were answered and implemented — history is in git (`a2b084a..0c61760`) and the docs. What remains is verification and vetoes:

## Open — needs your action

1. **Transcript retest (root-caused and rewritten 2026-07-14, after your 0/60 report).** You were right that this was simulatable without the add-on: reproducing the pipeline from Node against real YouTube showed every prior path was dead **regardless of auth** — WEB-client timedtext returns empty bodies without a BotGuard `pot` token, `get_transcript` 400s for every request shape, and (the extension-specific killer) Google bot-blocks any InnerTube POST whose `Origin` is `moz-extension://…` with a 403. SAPISIDHASH was aimed at the wrong layer and is fully removed, along with the `cookies` permission. The new pipeline is a cookie-less InnerTube `player` call (ANDROID client) → caption-track timedtext XML, plus a DNR rule rewriting `Origin` to `https://www.youtube.com`; it's verified live from Node (`npx vite-node scripts/transcript-diag.ts`) and covered by `e2e/live/transcripts.spec.ts`. To retest in the real add-on: rebuild, **Reload** in about:debugging (no permission re-grant needed this time — a permission was removed, not added), Settings → Re-score everything, and read the **"transcripts on N/M videos this run"** line. If it still fails, the line now includes a per-stage failure breakdown (e.g. `player-http-403 ×60`) — report that string; it pinpoints the broken stage.

2. **Fixture eyeball (public repo).** The committed parser fixtures (`src/services/youtube/fixtures/*-real-*.json`) are scrubbed of tracking/identity fields but name a few of your real subscribed channels and video titles (ChessNetwork, Chess Nexus, …). Say the word if that's too identifying and I'll swap in synthetic names.

3. **Score-quality eyeball.** Scoring now defaults to `gpt-5.4-mini` (OpenAI) / `claude-haiku-4-5` (Anthropic), both switchable in Settings. Worth ~20 real-feed scores against your own judgment.

## Standing decisions — veto anytime

- **Brand promo shelves are skipped.** Your home capture contained a "FIFA World Cup 2026™" advertiser shelf whose 12 videos the parser was ingesting as recommendations; it now ignores `brandVideoShelfRenderer` subtrees entirely (fits "no engagement bait").
- **The Settings model picker governs scoring only.** Profile suggestions stay on fixed stronger constants (`claude-sonnet-5` / `gpt-5.4-mini`).
- **Start-on-open is unmuted.** Stock Firefox may block audible autoplay, showing a Play button instead — allow autoplay for the extension via the URL-bar permissions icon (we deliberately don't mute to sneak past the policy).
- **Feedback staleness** (your "fine for now", 2026-07-14): votes steer newly scored videos; "Re-score everything" is the feed-wide apply gesture. A cheaper "re-score stale only" mode is possible on request.
