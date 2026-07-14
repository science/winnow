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

## 2026-07-14 (embed error 153 fix)

10. **Verify the watch-page player now works.** YouTube rejects embed requests without an HTTP `Referer` (player error 153), and Firefox never sends one from `moz-extension://` pages — that's the bug you hit. Fix: a `declarativeNetRequest` rule injects `Referer: https://winnow.misuse.org/` on embed sub-frame requests (curl-verified: no referer → 153; `https://www.youtube.com/` → error 152, YouTube rejects its own domain; `winnow.misuse.org` → plays). **Reload the temporary add-on** (manifest gained a permission + host permission) and click into a video. If it still errors, say so — the fallback is opening watch links in a real YouTube tab. Also flag if you'd rather claim a different referer domain than `winnow.misuse.org`.

11. **E2e coverage gap for extension-context bugs — accept or invest?** You asked for e2e coverage of this class of bug. What's now covered: unit tests lock manifest/DNR-rule/embed-URL wiring together, and live-tier e2e (`e2e/live/embed.spec.ts`) proves against real YouTube that referrer-less embeds still 153 and our injected value still plays — so if YouTube changes enforcement, the live suite goes red. What's structurally NOT covered: Playwright cannot load Firefox extensions, so no automated test runs the page at a real `moz-extension://` origin with the DNR rule active; the last inch stays manual (reload add-on, click a video). Closing that would mean a second harness (Selenium/geckodriver, which can install temporary add-ons). Recommendation: not worth it yet — one manual click after extension-surface changes, revisit if extension-only breakage recurs.

