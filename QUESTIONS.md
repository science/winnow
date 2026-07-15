# Questions for the user

Accumulated during autonomous work sessions. Answer at leisure; nothing here blocks work.

All items from the 2026-07-13/14 sessions (repo visibility, signing, fixtures, transcripts, models/SDKs, feedback, icon, CI, error 153, autoplay, e2e harness) were answered and implemented — history is in git (`a2b084a..0c61760`) and the docs. What remains is verification and vetoes:

## Open — needs your action

1. **Transcript retest (SAPISIDHASH shipped 2026-07-14).** InnerTube calls are now signed with your youtube.com SAPISID cookie (read-only; only a SHA-1 hash travels, only to youtube.com). To pick up the new `cookies` permission you must **Remove the add-on entirely and Load Temporary Add-on again** — "Reload" won't grant it (same trap as the error-153 fix; or install the signed xpi from `web-ext-artifacts/` for a permanent install). Then Settings → Re-score everything and report the **"transcripts on N/M videos this run"** line. If N is still 0 with 403s in a dev-build console, the next contingency is a DNR rule claiming `Origin: https://www.youtube.com` on get_transcript (same pattern as the error-153 Referer rule).

2. **Fixture eyeball (public repo).** The committed parser fixtures (`src/services/youtube/fixtures/*-real-*.json`) are scrubbed of tracking/identity fields but name a few of your real subscribed channels and video titles (ChessNetwork, Chess Nexus, …). Say the word if that's too identifying and I'll swap in synthetic names.

3. **Score-quality eyeball.** Scoring now defaults to `gpt-5.4-mini` (OpenAI) / `claude-haiku-4-5` (Anthropic), both switchable in Settings. Worth ~20 real-feed scores against your own judgment.

## Standing decisions — veto anytime

- **Brand promo shelves are skipped.** Your home capture contained a "FIFA World Cup 2026™" advertiser shelf whose 12 videos the parser was ingesting as recommendations; it now ignores `brandVideoShelfRenderer` subtrees entirely (fits "no engagement bait").
- **The Settings model picker governs scoring only.** Profile suggestions stay on fixed stronger constants (`claude-sonnet-5` / `gpt-5.4-mini`).
- **Start-on-open is unmuted.** Stock Firefox may block audible autoplay, showing a Play button instead — allow autoplay for the extension via the URL-bar permissions icon (we deliberately don't mute to sneak past the policy).
- **Feedback staleness** (your "fine for now", 2026-07-14): votes steer newly scored videos; "Re-score everything" is the feed-wide apply gesture. A cheaper "re-score stale only" mode is possible on request.
