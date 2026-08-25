# Winnow Privacy Policy

*Last updated: 2026-08-24 (v0.2.3)*

Winnow is a client-only Firefox extension. It has no server, no accounts, no telemetry, and no analytics. The developer receives no data of any kind from your use of Winnow. Everything below happens on your machine, under your control.

## What Winnow does with data

**Reads your YouTube feeds, locally.** Winnow fetches youtube.com pages (your subscriptions feed, homepage recommendations, your subscribed-channel list, and — only when you press "Go deeper" — search-result pages) using your own logged-in browser session, and parses the video and channel lists out of them. To YouTube this looks like ordinary page visits from your own browser. Transcript fetches are deliberately cookie-less.

**Reads only — Winnow never changes your YouTube account.** Winnow does not subscribe, unsubscribe, comment, like, rate, add to playlists, or alter your watch history. It has no permission to read your cookies and no code that could: the pages it fetches are requested the way any page request works, with your browser attaching your session itself. The one YouTube request Winnow makes that isn't a page read is a caption-track fetch for scoring, and that one is deliberately sent without your session at all.

**Searches YouTube when you press "Go deeper".** That button turns your interest profile into ordinary YouTube searches and reads the result pages, the same as typing them into YouTube's search box. It runs only when you press it. Creators you already follow are marked in the results so you can tell what's new; being marked is a display and ranking detail, computed on your machine from the subscription list Winnow read.

**Sends scoring inputs to the AI provider you configure.** To rank videos, Winnow sends the AI provider you chose (Anthropic or OpenAI) — under your own API key — the following:

- video metadata from your feeds: title, channel name, view counts, and similar
- transcript excerpts of those videos, when available
- your interest-profile text (the free-text description of what you want more and less of), and short titles of videos you voted on, as taste examples

This is the only place any of your data leaves your machine, it happens only after you supply an API key, and it goes directly from your browser to the provider you picked — no intermediary. Handling of that data is governed by your agreement with that provider ([Anthropic](https://www.anthropic.com/legal/privacy), [OpenAI](https://openai.com/policies/privacy-policy/)).

**Stores everything else locally.** Your API keys, profile text, votes, cached scores, your subscribed-channel list, and settings live in Firefox extension storage on your machine. Nothing is synced or uploaded. Uninstalling the extension deletes all of it.

**Remembers where you stopped watching.** So a long video resumes instead of restarting, Winnow records how far into each video you got — read from the embedded player in your own browser, stored locally alongside everything else, capped at the 500 most recent, and deleted when the video leaves your feed window or you finish it. This is more detailed than a simple watched/not-watched mark, so it is called out explicitly. It is never transmitted anywhere, including to YouTube: the player is embedded from youtube-nocookie.com, which is why YouTube cannot remember your place for you.

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
