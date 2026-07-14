# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Winnow is a Firefox browser extension (Manifest V3) that replaces the YouTube feed experience with an AI-curated one. It reads the user's real YouTube data (subscriptions feed + homepage recommendations) by fetching youtube.com pages with the user's own session cookies and parsing the embedded `ytInitialData` JSON, scores each video with an LLM (Anthropic or OpenAI, user-supplied keys) against a free-text interest profile, and renders a calm, bounded feed. Everything runs client-side; all state lives in `browser.storage.local`. No backend, no telemetry.

Product principles (do not relitigate): **no autoplay-next, no infinite scroll, no engagement bait**. The video the user clicked does start playing on open (that's intent, not a dark pattern); nothing ever queues or plays after it ends. Winnowed-out videos are hidden behind a fold, never deleted — curation stays auditable.

**Before starting feature work, read `docs/DEVELOPMENT.md`** — module map, invariants/gotchas, and recipes for common changes (parser shapes, providers, settings, storage keys, e2e). `docs/DESIGN.md` has the architecture and storage schema registry; `docs/TWO_PHASE_SCORING.md` the planned scoring evolution; `QUESTIONS.md` the open user-blocked items.

## Commands

```bash
npm run dev          # Vite dev server on 0.0.0.0:5173 (feed page in plain-browser mode)
npm run build        # Production build → dist/ (loadable as temporary add-on)
npm run check        # svelte-check / TypeScript
npm test             # Vitest unit tests (free tier — must pass with no API keys / no network)
npm run test:e2e     # Playwright e2e against the built page in demo mode
npm run zip          # Build + package dist/ as web-ext zip artifact
```

Loading the extension: build in the VM, then on the **host** Firefox open `about:debugging#/runtime/this-firefox` → "Load Temporary Add-on…" → pick `~/dev/winnow/dist/manifest.json`. The `~/dev` bind mount means no sync step. After rebuilds, click "Reload" there.

## Machine/VM notes

- Dev servers must bind `0.0.0.0` (this is a VM; the host browser connects in).
- `~/dev` is bind-mounted host↔VM: never run git simultaneously from both sides.

## Architecture

Three-layer client-only app, one Svelte SPA on an extension page (`feed.html`, hash routes `#/`, `#/watch/<id>`, `#/settings`):

- `src/lib/` — pure logic (types, formatting, hashing, tier bucketing). **All fully unit-testable, no browser APIs.** When adding logic, keep it pure and put it here.
- `src/services/` — boundary adapters: `youtube/` (credentialed fetch + `ytInitialData` parsing) and `scoring/` (provider calls + batching orchestrator). Thin by design; effort goes into `lib/`, not into elaborate runtime mocks.
- `src/stores/` + `src/components/` — Svelte stores for all cross-component/persisted state (wolfechat pattern: init from storage, subscribe → persist); Svelte 5 runes for component-local state only.

Hard constraints:

- **All persistence goes through `src/lib/storage.ts`** (browser.storage.local, localStorage fallback in plain-browser dev). Never touch storage APIs directly elsewhere. Keys are namespaced `winnow:*` and versioned (`:v1`); the schema registry lives in `docs/DESIGN.md`.
- **`feedParser.ts` is the fragility boundary.** YouTube's `ytInitialData` shape changes without notice. Parse defensively (missing nodes → skip item, never throw), keep the parse surface minimal, and cover every shape with captured-fixture tests. Parser breakage must surface as a friendly "parser needs updating" state, never a crash.
- **AI provider calls**: direct browser→provider fetch. Anthropic needs the `anthropic-dangerous-direct-browser-access: true` header (approved pattern, see wolfechat security note); OpenAI is a plain Bearer fetch. Model IDs are single reviewed constants and participate in the score-cache hash.
- **Zero third-party runtime scripts** — no CDNs, no analytics, nothing fetched at runtime except youtube.com and the user's chosen AI provider. This is a privacy promise, not a preference.
- Retry policy for external calls: backoff-retry only on 429/5xx/network; **fail fast on 4xx and malformed JSON** — those are bugs, not weather.

## Development methodology

### MVP first, vertical slices

Build the smallest end-to-end working increment, keep the extension installable at every step, then iterate. Don't gold-plate ahead of a working slice; don't add config/options for hypothetical needs.

### TDD red/green

All new logic follows Test-Driven Development:

1. **RED**: write a failing test describing the desired behavior; run it to prove it fails.
2. **GREEN**: write minimal code to pass.
3. **REFACTOR**: clean up, tests stay green.

Tests describe what the feature SHOULD do, not what is currently broken — name and comment them accordingly (`should skip shelf items without a videoId`, not `FAILS: parser crashes`). Never skip the RED step.

### DRY / reuse

Before implementing anything, search the codebase for existing infrastructure. Extend, don't duplicate: one storage wrapper, one retry helper, one prompt builder, one provider-adapter interface (`scoreBatch`). If existing code is embedded in a larger function, extract the reusable part rather than copying it. Duplicated code paths cause split-brain bug fixes.

### Test pyramid & tiers

| Tier | What | Where | Runs |
|---|---|---|---|
| Unit (free) | Pure `lib/` logic, parser against captured fixtures, scorer orchestration with stubbed providers | `src/**/*.test.ts` | every commit, CI, no keys, no network |
| E2E (free) | Playwright against the built feed page in demo mode (fixture data, storage shim) | `e2e/nonlive/` | CI |
| Live | Real AI-provider calls (and manual real-YouTube checks) | `e2e/live/` (`npm run test:e2e:live`; keys from gitignored `.env.production` or env) | manual only; skip gracefully when keys absent |
| Extension | Built zip installed into real headless Firefox (selenium + geckodriver), true `moz-extension://` origin, live YouTube network | `e2e/extension/` (`npm run test:e2e:ext`) | manual only; after manifest/DNR/embed changes |

Rules (movie-night conventions):
- Every test touching an external API is live-tier. The free tier must pass with API keys absent and network blocked.
- **Selectors live only inside e2e helpers** (`e2e/helpers/`). Spec files describe behavior through `fillX`/`clickX`/`getX`/`waitForX` helpers; no inline locators. Locator preference inside helpers: `getByLabel` → `getByRole` → `data-testid` → raw CSS.
- Unit tests alone are not sufficient: any multi-stage workflow (fetch → parse → score → bucket) needs at least one integration test wiring real internals with stubbed externals.
- Every provider/network interface gets a stub implementation for tests.

### Test failures are never "transient"

Tests must be 100% reliable. "Flaky", "race condition", "usually passes" are signals the failure is not understood, not explanations. When a test fails: capture the actual output, root-cause it, then either fix the bug, fix the test for determinism, fix the harness, or explicitly surface the gap to the user. Never ship on a red or handwaved suite.

### Git workflow

- `main` is the development branch and source of truth. Work happens on `main`; ephemeral feature branches optional.
- **Commit frequently at feature level** — each commit is one coherent feature/fix/refactor with tests, not a day of mixed work and not per-keystroke noise.
- **Before every commit run `git status`** and account for every untracked file: commit it, ignore it, or delete it. Features deployed without their files are a recurring house failure mode.
- Pushing `main` to origin is routine once CI exists (CI is the safety net). Never force-push. Tagged releases (`v*`) build the distributable zip via CI.
- **Never publish a release / submit to AMO without explicit user permission.**

### Auto-deploy / CI

GitHub Actions on every push: check + unit tests + build + upload the zipped extension as an artifact (`.github/workflows/ci.yml`). A green build on `main` must always produce an installable artifact — treat CI red as a stop-the-line event. Release tags additionally attach the zip to a GitHub Release.

## Code style

- **Maximal semicolons** (wolfechat rule): always end statements with semicolons — AI-written code plus ASI is a bug factory. No semicolons after function/class declarations or control-structure braces.
- TypeScript everywhere; `svelte-check` must stay clean.
- Logging via `src/lib/logger.ts`: `log.debug/info` are dev-only (tree-shaken from production builds via `import.meta.env.DEV`), `log.warn/error` always ship. No bare `console.*` in committed code.
- Tailwind utility classes; keep the palette consistent (defined in `app.css` design tokens).
- Comments state constraints the code can't show; no narration.

## User-input queue

The user is often AFK during work sessions. Questions that would block work go into `QUESTIONS.md` at the repo root (dated, with context and a recommendation); work continues on everything unblocked.
