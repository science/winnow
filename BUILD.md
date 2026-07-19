# Building Winnow from source

Reviewer build instructions for reproducing the submitted extension package.

## Environment

- OS: Linux (built and verified on Ubuntu 24.04; any x86_64/arm64 Linux or macOS works — the build has no native dependencies)
- Node.js: **24.14.0**
- npm: **11.9.0**

Install via [nvm](https://github.com/nvm-sh/nvm): `nvm install 24.14.0`.

## Build

```bash
npm ci          # exact dependency versions from the committed package-lock.json
npm run build   # vite build → dist/
```

The build output in `dist/` corresponds 1:1 to the contents of the submitted extension zip (the zip is `dist/` with `manifest.json` at the zip root, produced by `npm run zip` → `web-ext-artifacts/winnow-<version>.zip`).

## Verify

```bash
npm run zip
# then diff web-ext-artifacts/winnow-<version>.zip against the submitted package
```

The only tools involved are open-source npm packages pinned by `package-lock.json` (Vite, Svelte, TypeScript, Tailwind). No web-based or commercial build tools, no code fetched at build time.

## Notes for review

- The large minified bundle (`dist/assets/feed-*.js`) inlines two npm dependencies: `@anthropic-ai/sdk` and `openai`. The extension makes direct browser→provider API calls with the user's own key; there is no proxy server.
- `addons-linter`'s single `UNSAFE_VAR_ASSIGNMENT` warning in that bundle is Svelte 5's internal template reconciler (`svelte/src/internal/client/dom/reconciler.js`, trusted compiler-generated template strings). The application source contains no `innerHTML` or `{@html}` usage.
