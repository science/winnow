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

10. **Watch-page error 153 — fix verified in a real extension context, but YOUR Firefox still errors; three checks wanted.** YouTube rejects embed requests without an HTTP `Referer` (error 153); Firefox sends none from `moz-extension://` pages; a `declarativeNetRequest` rule now injects `Referer: https://winnow.misuse.org/` on embed sub-frames (note: `https://www.youtube.com/` gets rejected as error 152 — YouTube refuses its own domain). The new extension-tier harness (see #11) proves the fix in real headless Firefox 152: current build → playable; same build minus the DNR rule → Error 153. Since your host Firefox still shows 153 after a reload, in order of likelihood: (a) **Remove the add-on entirely and Load Temporary Add-on again** — don't trust "Reload" to pick up the two new manifest permissions; (b) **hard-refresh the watch page** (Ctrl+Shift+R) — a cached embed document bypasses the network layer where the header is injected; (c) if it still errors, report your Firefox version (Help → About) and, from the extension page's F12 console, the output of `await browser.declarativeNetRequest.getEnabledRulesets()` and `await browser.permissions.getAll()` — that tells us whether the ruleset loaded and the `youtube-nocookie.com` host permission got granted.

11. **Extension-tier e2e harness now exists (`npm run test:e2e:ext`).** Per your ask: `e2e/extension/watchEmbed.test.mjs` installs the built zip into real headless Firefox via selenium/geckodriver (both already on the VM), pre-seeds the extension UUID, opens `moz-extension://…/feed.html#/watch/<id>`, and asserts the YouTube player reaches a playable state — the genuine reproduction of the 153 context, which Playwright structurally can't provide (it can't load Firefox extensions). Manual tier (live YouTube network), not in CI. On your mock-feed idea: the click-through flow itself is already covered by nonlive Playwright in demo mode; the 153 bug wasn't in the flow but in the page *origin* — demo fixture IDs also aren't real videos, so the harness navigates straight to a real embeddable ID instead.

