# Winnow Privacy Policy

*Last updated: 2026-07-19 (v0.2.0)*

Winnow is a client-only Firefox extension. It has no server, no accounts, no telemetry, and no analytics. The developer receives no data of any kind from your use of Winnow. Everything below happens on your machine, under your control.

## What Winnow does with data

**Reads your YouTube feeds, locally.** Winnow fetches youtube.com pages (your subscriptions feed and homepage recommendations) using your own logged-in browser session, and parses the video lists out of them. To YouTube this looks like ordinary page visits from your own browser. Transcript fetches are deliberately cookie-less. Winnow never posts, changes, or deletes anything on your YouTube account.

**Sends scoring inputs to the AI provider you configure.** To rank videos, Winnow sends the AI provider you chose (Anthropic or OpenAI) — under your own API key — the following:

- video metadata from your feeds: title, channel name, view counts, and similar
- transcript excerpts of those videos, when available
- your interest-profile text (the free-text description of what you want more and less of), and short titles of videos you voted on, as taste examples

This is the only place any of your data leaves your machine, it happens only after you supply an API key, and it goes directly from your browser to the provider you picked — no intermediary. Handling of that data is governed by your agreement with that provider ([Anthropic](https://www.anthropic.com/legal/privacy), [OpenAI](https://openai.com/policies/privacy-policy/)).

**Stores everything else locally.** Your API keys, profile text, votes, cached scores, and settings live in Firefox extension storage on your machine. Nothing is synced or uploaded. Uninstalling the extension deletes all of it.

## What Winnow never does

- No Winnow server: no data is ever sent to the developer or any Winnow-operated service.
- No telemetry, analytics, crash reporting, or tracking of any kind.
- No third-party scripts: the extension makes network requests only to youtube.com / youtube-nocookie.com and to the single AI provider you configured.
- No selling, sharing, or monetizing of data — there is nothing collected to sell.

## Firefox data-collection disclosure

Winnow declares the following [data collection permissions](https://support.mozilla.org/kb/data-collection): **website content** and **browsing activity** — covering the video metadata and transcript excerpts from your YouTube feeds that are transmitted to your chosen AI provider for scoring, as described above. Winnow collects no technical or interaction data.

## A caveat worth knowing

API keys in extension storage are readable by anything with debugger access to your browser profile. This is standard for bring-your-own-key, client-only tools, but you should know it. Use a dedicated, spend-capped API key if that concerns you.

## Changes and contact

Changes to this policy are versioned in this repository's git history. Questions or concerns: open an issue at <https://github.com/science/winnow/issues>.
