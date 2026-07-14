# Questions for the user

Accumulated during autonomous work sessions. Answer at leisure; nothing here blocked the work.

## 2026-07-13 (initial build session)

1. **GitHub repo visibility.** You said winnow is OSS, so I created `science/winnow` **public**. Flip if you'd rather stay quiet until MVP: `gh repo edit science/winnow --visibility private`.

2. **Extension ID / permanent install.** The gecko ID is `winnow@misuse.org` (in `manifest.json`) — change it if you'd prefer a different domain. Temporary-add-on loading works today but resets when Firefox restarts; a *permanent* install needs a signed `.xpi` via `web-ext sign`, which needs AMO API credentials from your addons.mozilla.org account (unlisted signing is enough for personal use, no review queue). Two minutes of your time when you're ready, then I can wire a `npm run sign` script + CI job.

3. **Real logged-in fixtures wanted (top priority when you're back).** The parser is tested against a real *logged-out* channel page (modern `lockupViewModel` shape) plus synthetic logged-in shapes. To lock it to your real feeds: load the extension, let the feed refresh, then Settings → **Copy debug fixture**, and paste the JSON somewhere in the repo (or just tell me and I'll prune it into `src/services/youtube/fixtures/`).

4. **Transcript fetch needs in-browser verification.** From the VM (no browser session) the timedtext endpoint returned an empty body — probably session/proof-of-origin gating. The code degrades gracefully to metadata-only scoring, but check the console (`transcripts: N/M fetched` log line) on your first real scoring run. If it's 0/M with a real session, the fallback is InnerTube's `get_transcript` endpoint — I left the parsing pure functions ready either way.

5. **Live scoring validation.** Scoring is fully unit-tested against stubs, but no real Anthropic/OpenAI call has been made (no keys here, and I wouldn't use yours unasked). First real run: put a key in Settings, hit Refresh, and eyeball ~20 scores against your own judgment. Also worth checking: whether `gpt-4o-mini` is still the right cheap OpenAI model (`src/services/scoring/openaiScorer.ts` — one constant).

6. **Icon.** Placeholder is a dark rounded square with a green "w" (ImageMagick). Fine until it isn't.

7. **CI e2e note.** CI installs Chromium for Playwright each run (~30s with cache). If that ever annoys, we can cache the browser or gate e2e to PRs only.
