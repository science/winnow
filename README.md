# winnow

**Watch what matters.** Winnow is a Firefox extension that replaces the YouTube feed experience with an AI-curated one.

YouTube's algorithm optimizes for engagement — minutes watched per day. Winnow optimizes for something different: videos you actually want to watch and feel enriched by afterward. There's overlap between those two sets, but it's not a tight one, and the gap is filled with clickbait, engagement bait, and manufactured outrage preying on your monkey brain.

## How it works

1. Winnow reads your real YouTube data — your subscriptions feed **and** your homepage recommendations — using your own logged-in browser session. No OAuth setup, no YouTube API keys, no quota.
2. Each video is scored by an LLM (Anthropic or OpenAI — you bring your own API key) against your free-text interest profile: what you want *more* of, what you want *less* of. When a transcript is available it's weighed heavily — it reveals whether the content delivers on the title's promise.
3. You get a calm, bounded feed in tiers: **Top picks**, **Worth a look**, and a collapsed **Winnowed out** fold. Nothing is deleted — every filtered video is one click away, with the reason it was filtered, so the curation stays auditable.

Deliberately absent, forever: autoplay, infinite scroll, engagement-ranked anything. The feed has a bottom, and says so.

## Install (development build)

```bash
git clone https://github.com/science/winnow && cd winnow
npm install
npm run build
```

Then in Firefox: `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → select `dist/manifest.json` → click the winnow toolbar button. Make sure you're signed in to youtube.com in the same browser.

Want to poke around without keys or a YouTube session? Open the feed page with `?demo=1` — fixture data and a stub scorer, fully offline.

## Privacy

- Everything runs in your browser. There is no winnow server and no telemetry.
- Your API keys and profile live in extension storage on your machine.
- The only network calls are to youtube.com (as you, for your data) and to the AI provider you configured (video metadata + transcript excerpts + your profile text, under your own key).
- Zero third-party runtime scripts — policy, not preference.
- Keys in extension storage are readable by anything with debugger access to your browser profile: standard for BYO-key client-only tools, but know it.

## A note on YouTube's internals

Winnow parses the `ytInitialData` blob YouTube embeds in its own pages — the same data the page renders from. That surface is undocumented and changes without notice; winnow parses defensively and shows a "parser may need updating" notice rather than breaking, but occasional maintenance is the tax this architecture pays for recommendations + transcripts + zero-setup auth. Reading your own session, on your own machine, for your own consumption is the same category as Unhook/SponsorBlock/DeArrow.

## Development

```bash
npm run dev        # feed page at http://localhost:5173/feed.html (use ?demo=1)
npm test           # unit tests — free tier: no network, no keys
npm run test:e2e   # Playwright against the built page in demo mode
npm run check      # svelte-check
npm run zip        # package web-ext-artifacts/winnow-<version>.zip
```

CI (GitHub Actions) runs check + unit + e2e + build on every push and attaches the zip; tags `v*` create a GitHub Release with the artifact.

Architecture and data-flow: `docs/DESIGN.md`. Hands-on developer guide (module map, invariants, feature recipes): `docs/DEVELOPMENT.md`. Planned scoring evolution: `docs/TWO_PHASE_SCORING.md`. Engineering conventions (TDD, test tiers, commit discipline): `CLAUDE.md`.

## License

[Apache 2.0](LICENSE)
