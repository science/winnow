# Questions for the user

Accumulated during autonomous work sessions. Answer at leisure; nothing here blocked the work.

## 2026-07-13 (initial build session)

1. **GitHub repo visibility.** You said winnow is OSS, so I created `science/winnow` **public**. Flip if you'd rather stay quiet until MVP: `gh repo edit science/winnow --visibility private`.

2. **Extension ID / permanent install.** The gecko ID is `winnow@misuse.org` (in `manifest.json`) — change it if you'd prefer a different domain. Temporary-add-on loading works today but resets when Firefox restarts; a *permanent* install needs a signed `.xpi` via `web-ext sign`, which needs AMO API credentials from your addons.mozilla.org account (unlisted signing is enough for personal use, no review queue). Two minutes of your time when you're ready, then I can wire a `npm run sign` script + CI job.

3. **Real logged-in fixtures wanted (top priority when you're back).** The parser is tested against a real *logged-out* channel page (modern `lockupViewModel` shape) plus synthetic logged-in shapes. To lock it to your real feeds: load the extension, let the feed refresh, then Settings → **Copy debug fixture**, and paste the JSON somewhere in the repo (or just tell me and I'll prune it into `src/services/youtube/fixtures/`).

4. **Transcript seam verdict wanted.** ~~Check the console log line~~ **Update 2026-07-14:** the InnerTube `get_transcript` fallback is now implemented (timedtext first, InnerTube second, cookies-only auth), and the feed shows a **"transcripts on N/M videos this run"** line in ordinary production builds — no dev build needed. After your next re-score: (a) if N > 0, the seam works — say which; (b) if N is 0, hit Settings → **Copy debug fixture** (it now bundles the last watch-page player response, watch ytInitialData, and InnerTube response) and paste it back so I can lock real shapes as fixtures. If the console (dev build) shows 401/403 warnings from InnerTube, the next move is SAPISIDHASH auth — that requires adding the `cookies` permission to `manifest.json`, which I won't do without your explicit OK.

5. **Live scoring validation.** ~~No real Anthropic/OpenAI call has been made.~~ **Update 2026-07-14:** live e2e tests (`npm run test:e2e:live`, keys from `.env.production`) now exercise both providers against their real APIs — strict schemas accepted, scores valid, on-profile substance outscores drama bait, bait flagged clickbait. Still worth your eyeball: ~20 scores on your *real* feed against your own judgment, and whether `gpt-4o-mini` is still the right cheap OpenAI model (`src/services/scoring/openaiScorer.ts` — one constant).

6. **Icon.** Placeholder is a dark rounded square with a green "w" (ImageMagick). Fine until it isn't.

7. **CI e2e note.** CI installs Chromium for Playwright each run (~30s with cache). If that ever annoys, we can cache the browser or gate e2e to PRs only.

## 2026-07-14 (feedback + transcripts + vetted-only feed session)

8. **Feedback staleness tradeoff — sign off or veto.** Votes deliberately do NOT invalidate cached scores (each vote would otherwise trigger a full paid re-score). They steer newly scored videos automatically; **"Re-score everything" in Settings is the apply-feed-wide gesture**. If that feels wrong in use, a cheaper "re-score stale only" mode is possible — say the word.

9. **Model for profile suggestions.** "Suggest profile updates from my feedback" reuses the cheap scoring models (`claude-haiku-4-5` / `gpt-4o-mini`). It's a rare, quality-sensitive call — if the suggestions read shallow on real data, a stronger model here costs pennies per use. Both providers produced good suggestions in live e2e; your call after real use.
