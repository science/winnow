# winnow

**Watch what matters.** Winnow is a Firefox extension that replaces the YouTube feed experience with an AI-curated one.

YouTube's algorithm optimizes for engagement — minutes watched per day. Winnow optimizes for something different: videos you actually want to watch and feel enriched by afterward. There's overlap between those two sets, but it's not a tight one, and the gap is filled with clickbait, engagement bait, and manufactured outrage preying on your monkey brain.

## How it works

1. Winnow reads your real YouTube data — your subscriptions feed **and** your homepage recommendations — using your own logged-in browser session. No OAuth setup, no API keys for YouTube, no quota.
2. Each video is scored by an LLM (Anthropic or OpenAI — you bring your own API key) against your free-text interest profile: what you want more of, what you want less of.
3. You get a calm, bounded feed sorted into tiers: **Top picks**, **Worth a look**, and a collapsed **Winnowed out** section. Nothing is deleted — every filtered video is one click away, with the reason it was filtered, so the curation stays auditable.

Deliberately absent, forever: autoplay, infinite scroll, engagement-ranked anything.

## Privacy

- Everything runs in your browser. There is no winnow server and no telemetry.
- Your API keys and profile live in extension storage on your machine.
- The only network calls are to youtube.com (as you, for your data) and to the AI provider you configured (video *metadata* is sent for scoring).
- Zero third-party runtime scripts.

## Status

Early development — walking skeleton. See `docs/DESIGN.md` for the architecture and roadmap.

## Install (development)

```bash
npm install
npm run build
```

Then in Firefox: `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → select `dist/manifest.json`. Click the winnow toolbar button.

## Development

```bash
npm run dev        # feed page at http://localhost:5173/feed.html (plain-browser mode)
npm test           # unit tests (no network, no keys)
npm run check      # svelte-check
npm run zip        # package web-ext-artifacts/winnow-<version>.zip
```

See `CLAUDE.md` for engineering conventions (TDD, test tiers, commit discipline).

## License

[Apache 2.0](LICENSE)
