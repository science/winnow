# Questions for the user

Accumulated during autonomous work sessions. Answer at leisure; nothing here blocked the work unless marked **BLOCKING**.

## 2026-07-13 (initial build session)

1. **GitHub repo visibility.** You said winnow is OSS and asked for the `science` account as origin. I created the repo **public** (`science/winnow`). Flip to private if you'd rather keep it quiet until MVP: `gh repo edit science/winnow --visibility private`.

2. **Extension ID / AMO signing.** I set the gecko extension ID to `winnow@misuse.org` in `manifest.json`. Fine? Also: producing a *signed* `.xpi` you can install permanently (rather than a temporary add-on) requires AMO API credentials (`web-ext sign` with `AMO_JWT_ISSUER`/`AMO_JWT_SECRET` from addons.mozilla.org). That's your account + a decision (unlisted vs listed) — left undone. Temporary-add-on loading works today.

3. **Subscriptions-feed fixture wanted.** I could only capture *logged-out* YouTube page shapes from the VM. The parser is built and tested against those plus synthetic logged-in shapes assembled from documented renderer structures. When you're back: load the extension, open winnow → Settings → "Copy debug fixture", and paste the JSON into `src/services/youtube/fixtures/` — then I can lock the parser to your real logged-in shapes (subscriptions grid + homepage).

4. **Live scoring validation.** Scoring is fully unit-tested against stubbed providers, but no real Anthropic/OpenAI call has been made (no keys on the VM, and I wouldn't use yours without asking). First real run: put your key into winnow Settings and hit Refresh; watch for anything odd in reasons/scores. If you want, drop a low-limit test key into `.env.local` as documented in `e2e/live/README.md` and I'll run the live tier.

5. **Icon.** I generated a minimal placeholder icon (dark rounded square, "w"). Want something designed, or is placeholder fine until later?
