#!/usr/bin/env bash
# Cron wrapper that fills private-fixtures/transcripts.json a video or two at
# a time, so the household IP never sends YouTube a burst (a burst got it
# Google-blocked on 2026-10-10). capture-transcripts.ts stops at the first
# block and pauses every run for 24 h.
#
#   scripts/transcript-trickle.sh fetch <N>   # try up to N unstored capture videos
#   scripts/transcript-trickle.sh commit      # commit + push the store if it changed
#
# Installed in the dev-2 VM's crontab (crontab -l); output goes to
# ~/.local/state/winnow-capture/trickle.log.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
STATE="$HOME/.local/state/winnow-capture"
mkdir -p "$STATE"
export PATH="$HOME/.local/share/fnm/aliases/default/bin:$PATH"
exec >>"$STATE/trickle.log" 2>&1
# One run at a time: a slow run must never overlap the next slot.
exec 9>"$STATE/lock"
flock -n 9 || { echo "$(date -Is) previous run still going; skipping"; exit 0; }

case "${1:-}" in
  fetch)
    echo "$(date -Is) fetch ${2:?count}"
    cd "$REPO" && npx vite-node scripts/capture-transcripts.ts --capture --max "$2"
    ;;
  commit)
    cd "$REPO/private-fixtures"
    if git diff --quiet -- transcripts.json; then
      echo "$(date -Is) commit: no new transcripts"
      exit 0
    fi
    n=$(grep -c '^"' transcripts.json)
    git add transcripts.json
    git commit -q -m "Transcript trickle: $n capture videos stored" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
    git push -q
    echo "$(date -Is) commit: pushed, $n stored"
    ;;
  *)
    echo "usage: transcript-trickle.sh fetch <N> | commit" >&2
    exit 1
    ;;
esac
