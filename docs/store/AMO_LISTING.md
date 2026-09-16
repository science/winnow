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
4. Videos play inline, in place, in a privacy-enhanced embed — and pick up where you left off. Nothing queues or plays after one ends.

**More than one you.** Keep separate profiles — work, leisure, a hobby — and switch the whole feed between them in one click; each keeps its own scores and its own votes.

**Go deeper, on request.** A single button turns your profile into YouTube searches and vets what comes back, so you can find creators past your subscriptions. It runs only when you press it. Winnow marks creators you already follow, and never subscribes, unsubscribes, votes, comments, or changes anything on your YouTube account — it reads.

**Deliberately absent, forever:** autoplay-next, infinite scroll, engagement-ranked anything. The feed has a bottom, and says so.

**Private by construction:** there is no Winnow server and no telemetry. The only network traffic is to youtube.com (as you, for your data) and directly to the AI provider you configured, under your own key. Full policy: https://github.com/science/winnow/blob/main/PRIVACY.md

**You'll need:** a youtube.com login in the same browser, and an Anthropic or OpenAI API key (a cheap model works well — a cold start on a ~200-video feed costs on the order of $0.10, daily refreshes cents).

Source code: https://github.com/science/winnow

## Version notes (What's new — 0.2.3)

Better filtering, and a calmer way to watch.

- **Two-phase scoring is now the default engine.** Each video is first digested from its transcript, then ranked against your profile by a fixed rubric instead of a free-form model score — steadier rankings, far cheaper re-ranks, and reasons that name the part of your profile they came from.
- **Cut-score ranking.** Clickbait and overclaiming titles are capped behind the fold rather than merely demoted, and a video that matches none of your stated topics can no longer float into Top picks on style alone. Nothing is deleted; everything winnowed stays visible with its reason.
- **Multiple profiles.** Work, leisure, a hobby — switch the whole feed between them in one click, each with its own scores and votes.
- **Go deeper.** A button that turns your profile into YouTube searches and vets the results, so you can find creators beyond your subscriptions. Runs only when pressed; creators you already follow are marked.
- **Inline player with resume.** Videos open in place instead of on a separate page, and pick up where you left off. Still nothing autoplays after them.

Permissions are unchanged from the previously listed versions.

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

Winnow is a client-only extension: no backend, no telemetry, no remote scripts, and **no writes to the user's YouTube account unless the user opts in** — it reads the user's own feeds and renders a re-ranked view of them. Four things in the package deserve explanation:

1. **Permissions, and specifically why there is no `cookies` permission.** The manifest requests `storage`, `declarativeNetRequestWithHostAccess`, and host access to `youtube.com` / `youtube-nocookie.com` — nothing else.

   The extension does read the user's signed-in YouTube pages, but it does so the way any page fetch works: `fetch(..., { credentials: "include" })` against `youtube.com`, with the browser attaching the user's cookies itself. The extension never enumerates, reads, stores, or transmits any cookie value, and it holds no API that could — `browser.cookies` is not available to it. There is no `webRequest`, no content script, and no code running on youtube.com itself.

   (An earlier development build did request `cookies`, to sign an account write. That feature is not in this version; the permission and all of its code are removed. The previously listed versions 0.2.1 and 0.2.2 likewise did not request it.)

2. **DNR header rewrites (one static rule in `dnr-rules.json`, one dynamic rule).**
   (a) `Origin: https://www.youtube.com` on requests to `youtube.com/youtubei/v1/*` (XHR only). These are the extension's own cookie-less InnerTube calls that fetch a video's caption track, so the AI can score what a video actually says rather than what its title claims. Google's anti-abuse layer rejects the `moz-extension://…` origin Firefox would otherwise stamp on them. The rule is scoped to that path prefix on youtube.com and to requests the extension itself makes; it does not touch requests from any web page, and it is not an authentication mechanism — those transcript requests are deliberately unauthenticated.
   (b) `Referer: https://winnow.misuse.org/` on `youtube-nocookie.com/embed/*` and `youtube.com/embed/*` sub-frames, so the embed player works from the extension page (YouTube returns player error 153 to an embed with no Referer). It is registered at runtime (`src/services/player/embedReferer.ts`) as a dynamic rule with `initiatorDomains` set to the extension's own moz-extension host, so it applies only to players the extension's page embeds, never to embeds on websites the user visits. It has to be dynamic because that host differs per install.

3. **Credentialed youtube.com fetches.** The extension fetches `youtube.com`, `/feed/subscriptions`, `/feed/channels`, and `/results?search_query=…` with the user's own session (host permission) and parses the embedded `ytInitialData` JSON — the user's own feed, subscription list, and searches, read on the user's machine, for the user's consumption. All four are ordinary GETs. The extension issues no POST to any Google endpoint: it never comments, likes, rates, subscribes, unsubscribes, or edits playlists.

   **One opt-in setting, off by default: "Let Winnow act on my YouTube account"** (Settings → YouTube account). When the user turns it on, videos play in the standard `youtube.com/embed` player instead of `youtube-nocookie.com/embed`. That player runs with the user's YouTube sign-in, so its own playback reporting can add the video to the user's watch history, which is the reason for the setting. The extension makes no additional requests for this and still reads no cookies. With the setting off (the default), the extension doesn't alter watch history.

4. **Large minified bundle.** `assets/feed-*.js` inlines the `@anthropic-ai/sdk` and `openai` npm packages for direct browser→provider API calls with the user's own key (hence the `anthropic-dangerous-direct-browser-access` header in Anthropic requests — the SDK's sanctioned browser mode for BYO-key apps). Source zip with build instructions (`BUILD.md`) is submitted alongside; `npm ci && npm run build` on Node 24.14.0 reproduces `dist/` exactly. The linter's single `UNSAFE_VAR_ASSIGNMENT` warning is Svelte 5's internal template reconciler (trusted compiler-generated strings); application source contains no `innerHTML`/`{@html}`.

Data collection declaration (`websiteContent`, `browsingActivity`) covers the video metadata and transcript excerpts from the user's YouTube feeds that are sent to the user's chosen AI provider for scoring. The developer receives nothing.

To test without a YouTube session or API key: open the extension page with `?demo=1` (fixture data, stub scorer, fully offline).
