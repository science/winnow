# AMO listing copy

Paste-ready content for the addons.mozilla.org Developer Hub listing form.
Assets in this directory: `01-feed-tiers.png`, `02-winnowed-fold.png`, `03-settings.png`
(2560×1600 screenshots), listing icon = `public/icon-128.png`.

## Name

Winnow

## Summary (short, shown in search results)

Your YouTube feed, winnowed down to what you actually want to watch. AI scores your subscriptions and recommendations against your own interest profile — no autoplay, no infinite scroll, no engagement bait. Bring your own AI key; everything runs in your browser.

## Description

YouTube's algorithm optimizes for minutes watched. Winnow optimizes for something different: videos you actually want to watch and feel enriched by afterward.

**How it works**

1. Winnow reads your real YouTube data — your subscriptions feed and homepage recommendations — using your own logged-in browser session. No OAuth setup, no YouTube API keys, no quota.
2. Each video is scored by an AI model (Anthropic or OpenAI — you bring your own API key) against your free-text interest profile: what you want more of, what you want less of. When a transcript is available it's weighed heavily — it reveals whether the content delivers on the title's promise.
3. You get a calm, bounded feed in tiers: **Top picks**, **Worth a look**, and a collapsed **Winnowed out** fold. Nothing is deleted — every filtered video stays one click away, with the reason it was filtered, so the curation is always auditable.

**Deliberately absent, forever:** autoplay-next, infinite scroll, engagement-ranked anything. The feed has a bottom, and says so.

**Private by construction:** there is no Winnow server and no telemetry. The only network traffic is to youtube.com (as you, for your data) and directly to the AI provider you configured, under your own key. Full policy: https://github.com/science/winnow/blob/main/PRIVACY.md

**You'll need:** a youtube.com login in the same browser, and an Anthropic or OpenAI API key (a cheap model works well — a cold start on a ~200-video feed costs on the order of $0.10, daily refreshes cents).

Source code: https://github.com/science/winnow

## Categories

- Firefox desktop: Search & Discovery (or closest available; second choice: Entertainment)
- Android: not targeted (min Firefox for Android 142 declared, but untested — leave Android unchecked)

## Links & fields

- Homepage: https://github.com/science/winnow
- Support site: https://github.com/science/winnow/issues
- Support email: (fill in)
- License: Apache-2.0
- Privacy policy: https://github.com/science/winnow/blob/main/PRIVACY.md

## Notes to reviewer

Winnow is a client-only extension: no backend, no telemetry, no remote scripts. Three things in the package deserve explanation:

1. **DNR header rewrites (`dnr-rules.json`, 2 rules).**
   (a) `Origin: https://www.youtube.com` is set on requests to `youtube.com/youtubei/v1/*` (XHR). These are cookie-less InnerTube transcript fetches made from the extension page; Google's anti-abuse layer rejects the `moz-extension://` origin Firefox would otherwise send. The rewrite makes the extension's own first-party-style requests acceptable to YouTube; it does not touch requests from any web page.
   (b) `Referer: https://winnow.misuse.org/` is set on `youtube-nocookie.com/embed/*` sub-frames, so the privacy-enhanced embed player works from the extension page.

2. **Credentialed youtube.com fetches.** The extension fetches `youtube.com` and `/feed/subscriptions` with the user's own session (host permission, no `cookies` API) and parses the embedded `ytInitialData` JSON — the user's own feed, read on the user's machine, for the user's consumption. Nothing is posted or modified.

3. **Large minified bundle.** `assets/feed-*.js` inlines the `@anthropic-ai/sdk` and `openai` npm packages for direct browser→provider API calls with the user's own key (hence the `anthropic-dangerous-direct-browser-access` header in Anthropic requests — the SDK's sanctioned browser mode for BYO-key apps). Source zip with build instructions (`BUILD.md`) is submitted alongside; `npm ci && npm run build` on Node 24.14.0 reproduces `dist/` exactly. The linter's single `UNSAFE_VAR_ASSIGNMENT` warning is Svelte 5's internal template reconciler (trusted compiler-generated strings); application source contains no `innerHTML`/`{@html}`.

Data collection declaration (`websiteContent`, `browsingActivity`) covers the video metadata and transcript excerpts from the user's YouTube feeds that are sent to the user's chosen AI provider for scoring. The developer receives nothing.

To test without a YouTube session or API key: open the extension page with `?demo=1` (fixture data, stub scorer, fully offline).
