# Questions for the user

Accumulated during autonomous work sessions. Answer at leisure; nothing here blocked the work.

## 2026-07-13 (initial build session)

1. **GitHub repo visibility.** You said winnow is OSS, so I created `science/winnow` **public**. Flip if you'd rather stay quiet until MVP: `gh repo edit science/winnow --visibility private`.

User: Public is correct

2. **Extension ID / permanent install.** The gecko ID is `winnow@misuse.org` (in `manifest.json`) — change it if you'd prefer a different domain. Temporary-add-on loading works today but resets when Firefox restarts; a *permanent* install needs a signed `.xpi` via `web-ext sign`, which needs AMO API credentials from your addons.mozilla.org account (unlisted signing is enough for personal use, no review queue). Two minutes of your time when you're ready, then I can wire a `npm run sign` script + CI job.

User: I've added a mozilla addons JWT API key (issuer/secret) to the newly created ./credentials folder in env.production (which should be gitignored)

→ **Resolved 2026-07-14.** `credentials/` is now gitignored (it wasn't — the old `.env.production` rule didn't match; fixed before anything else). `npm run sign` builds + signs unlisted via AMO; verification sign succeeded (`web-ext-artifacts/aac8e1d4b34d47a38eeb-0.1.0.xpi` — install it via about:addons for a restart-surviving install). CI signs on `v*` tags (JWT values pushed to GitHub secrets) and attaches the xpi to the release. Note: AMO refuses to re-sign a version it has seen, so each tag needs a version bump in both package.json and public/manifest.json (a unit test keeps them matching).

3. **Real logged-in fixtures wanted (top priority when you're back).** The parser is tested against a real *logged-out* channel page (modern `lockupViewModel` shape) plus synthetic logged-in shapes. To lock it to your real feeds: load the extension, let the feed refresh, then Settings → **Copy debug fixture**, and paste the JSON somewhere in the repo (or just tell me and I'll prune it into `src/services/youtube/fixtures/`).

User: I put a fixtures folder in ./e2e/fixtures with a json file there with like-live data from the plugin. Feel free to move it elsewhere if there's a better location (and remove this new folder)

→ **Resolved 2026-07-14.** Parser coverage against the full capture was 100% before pruning: subscriptions 105/105 videos, home 34/34 (22 modern lockups + 12 legacy videoRenderers), Shorts correctly skipped. Pruned it into five small fixtures in `src/services/youtube/fixtures/` (`*-real-*.json` — true nesting preserved, tracking/identity fields scrubbed, zero datasyncId/visitor tokens) with regression-lock tests, and deleted `e2e/fixtures/` (the 13.6MB raw never entered git). Two things for your eyes: (a) the fixtures name a few of your real subscribed channels/video titles in the public repo (ChessNetwork, Chess Nexus, …) — eyeball `git show --stat HEAD` and veto if too identifying; (b) **behavior change found via your capture**: home contained a "FIFA World Cup 2026™" `brandVideoShelfRenderer` (advertiser-injected promo shelf) whose 12 videos the parser was ingesting as ordinary recommendations — it now skips brand shelves entirely (fits "no engagement bait"; say the word to revert).

4. **Transcript seam verdict wanted.** ~~Check the console log line~~ **Update 2026-07-14:** the InnerTube `get_transcript` fallback is now implemented (timedtext first, InnerTube second, cookies-only auth), and the feed shows a **"transcripts on N/M videos this run"** line in ordinary production builds — no dev build needed. After your next re-score: (a) if N > 0, the seam works — say which; (b) if N is 0, hit Settings → **Copy debug fixture** (it now bundles the last watch-page player response, watch ytInitialData, and InnerTube response) and paste it back so I can lock real shapes as fixtures. If the console (dev build) shows 401/403 warnings from InnerTube, the next move is SAPISIDHASH auth — that requires adding the `cookies` permission to `manifest.json`, which I won't do without your explicit OK.

User: I see this item in the console log, after reloading the addon:
`[winnow] InnerTube get_transcript rejected (403) for 0TILwM-FpLk — cookies-only auth may be insufficient (SAPISIDHASH contingency, see QUESTIONS.md)`

→ **SAPISIDHASH implemented 2026-07-14** (you approved the `cookies` permission). InnerTube calls are now signed with `Authorization: SAPISIDHASH` derived from your youtube.com SAPISID cookie (read-only; only the SHA-1 hash travels, only to youtube.com). **Retest wanted:** rebuild, then **Remove the add-on entirely and Load Temporary Add-on again** (new permission — "Reload" is not enough; same trap as the error-153 fix), Settings → Re-score everything, and report the "transcripts on N/M videos this run" line. If N is still 0 and a dev-build console still shows 403s *with* SAPISIDHASH, the next contingency is a DNR rule claiming `Origin: https://www.youtube.com` on the get_transcript request (same pattern as the error-153 Referer rule) — currently we can only claim it via `X-Origin` because fetch can't set `Origin`.


5. **Live scoring validation.** ~~No real Anthropic/OpenAI call has been made.~~ **Update 2026-07-14:** live e2e tests (`npm run test:e2e:live`, keys from `.env.production`) now exercise both providers against their real APIs — strict schemas accepted, scores valid, on-profile substance outscores drama bait, bait flagged clickbait. Still worth your eyeball: ~20 scores on your *real* feed against your own judgment, and whether `gpt-4o-mini` is still the right cheap OpenAI model (`src/services/scoring/openaiScorer.ts` — one constant).

User: gpt-4o-mini is absolutely the incorrect model. The correct model is `gpt-5.4-mini` -- this model exists and is real. You can also reference the WolfeChat project and let the user pick from an API enumerated list of models provided by each AI company, but the default for now should be gpt-5.4-mini

Related: we should be using JS SDKs to interact with the models, not custom coded API calls (Wolfechat and many other local ~/dev projects use SDKs for these model providers)

→ **Resolved 2026-07-14, three commits.** (a) Provider calls now go through the official SDKs (`@anthropic-ai/sdk`, `openai`, both `dangerouslyAllowBrowser` — note wolfechat actually uses the SDK only for Anthropic and raw fetch for OpenAI; winnow now uses SDKs for both, with `maxRetries: 0` so the house single-retry policy stays in scorer.ts). (b) Default OpenAI scoring model is `gpt-5.4-mini`, verified live against the real API; `temperature` was dropped from OpenAI payloads since gpt-5.x rejects non-default sampling. (c) Settings now has a per-provider model picker populated from each provider's live `/v1/models` list (wolfechat pattern), persisted in `winnow:settings:v1`; changing model auto-invalidates the score cache via the existing hash.

6. **Icon.** Placeholder is a dark rounded square with a green "w" (ImageMagick). Fine until it isn't.

User: fine

7. **CI e2e note.** CI installs Chromium for Playwright each run (~30s with cache). If that ever annoys, we can cache the browser or gate e2e to PRs only.

User: fine

## 2026-07-14 (feedback + transcripts + vetted-only feed session)

8. **Feedback staleness tradeoff — sign off or veto.** Votes deliberately do NOT invalidate cached scores (each vote would otherwise trigger a full paid re-score). They steer newly scored videos automatically; **"Re-score everything" in Settings is the apply-feed-wide gesture**. If that feels wrong in use, a cheaper "re-score stale only" mode is possible — say the word.

User: fine for now

9. **Model for profile suggestions.** "Suggest profile updates from my feedback" reuses the cheap scoring models (`claude-haiku-4-5` / `gpt-4o-mini`). It's a rare, quality-sensitive call — if the suggestions read shallow on real data, a stronger model here costs pennies per use. Both providers produced good suggestions in live e2e; your call after real use.

User: gpt-5.4-mini is fine openAI (mid-tier model), but better for anthropic to use sonnet (v5) for this type of call

## 2026-07-14 (embed error 153 fix)

10. **Watch-page error 153 — fix verified in a real extension context, but YOUR Firefox still errors; three checks wanted.** YouTube rejects embed requests without an HTTP `Referer` (error 153); Firefox sends none from `moz-extension://` pages; a `declarativeNetRequest` rule now injects `Referer: https://winnow.misuse.org/` on embed sub-frames (note: `https://www.youtube.com/` gets rejected as error 152 — YouTube refuses its own domain). The new extension-tier harness (see #11) proves the fix in real headless Firefox 152: current build → playable; same build minus the DNR rule → Error 153. Since your host Firefox still shows 153 after a reload, in order of likelihood: (a) **Remove the add-on entirely and Load Temporary Add-on again** — don't trust "Reload" to pick up the two new manifest permissions; (b) **hard-refresh the watch page** (Ctrl+Shift+R) — a cached embed document bypasses the network layer where the header is injected; (c) if it still errors, report your Firefox version (Help → About) and, from the extension page's F12 console, the output of `await browser.declarativeNetRequest.getEnabledRulesets()` and `await browser.permissions.getAll()` — that tells us whether the ruleset loaded and the `youtube-nocookie.com` host permission got granted.

User: The error 153 is fixed. I would like to add a feature here: clicking on a video opens the video with the video playing automatically. It's senseless UX to have the video open but not play (actual autoplay --starting a new video after an old one finishes-- is a different dark pattern entirely)

→ **Shipped 2026-07-14.** `embedUrl` now carries `autoplay=1` and the iframe grants `allow="autoplay"`; docs reworded to "no autoplay-next" (start-on-open is intent). One caveat: stock Firefox blocks *audible* autoplay by default — if the video opens paused on your machine, click the permissions icon in the URL bar on the watch page (or Settings → Privacy & Security → Autoplay) and choose "Allow Audio and Video" for the extension. We deliberately do NOT mute to sneak past the policy. The extension-tier harness proves both paths: autoplay-allowed → video actually playing; default prefs → play button, never an error.

11. **Extension-tier e2e harness now exists (`npm run test:e2e:ext`).** Per your ask: `e2e/extension/watchEmbed.test.mjs` installs the built zip into real headless Firefox via selenium/geckodriver (both already on the VM), pre-seeds the extension UUID, opens `moz-extension://…/feed.html#/watch/<id>`, and asserts the YouTube player reaches a playable state — the genuine reproduction of the 153 context, which Playwright structurally can't provide (it can't load Firefox extensions). Manual tier (live YouTube network), not in CI. On your mock-feed idea: the click-through flow itself is already covered by nonlive Playwright in demo mode; the 153 bug wasn't in the flow but in the page *origin* — demo fixture IDs also aren't real videos, so the harness navigates straight to a real embeddable ID instead.

User: good work, thank you.

