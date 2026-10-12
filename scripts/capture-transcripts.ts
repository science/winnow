// Fill the local transcript store (scripts/transcriptStore.ts) — the ONLY
// bulk YouTube transcript fetch in the repo. Videos already stored are
// skipped, so each is fetched once, ever. Paced 60 s apart. The first block
// (a 429, or a "confirm you're not a bot" check) stops the run and pauses
// every run for 24 h: Google's IP-wide block also cuts off the user's own
// Winnow, and every further request extends it. More than a few dozen new
// videos needs the user's OK, or a network other than the household's.
//
//   npx vite-node scripts/capture-transcripts.ts --capture [--max N]   # the 126-video gotham capture
//   npx vite-node scripts/capture-transcripts.ts <videoId>... [--max N]
//
// scripts/transcript-trickle.sh runs `--capture --max 1|2` from cron.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ENRICH_TRANSCRIPT_CHARS } from "../src/services/scoring/enrichPrompt";
import { isYouTubeBlock } from "../src/services/youtube/transcripts";
import { captureVideos } from "./captureFixture";
import { isStored, storedExcerpt, TRANSCRIPT_STORE } from "./transcriptStore";

const PACE_MS = 60_000;
const PAUSE_MS = 24 * 60 * 60 * 1000;
// Outside the repo, so a pause survives checkouts and can't be committed.
const PAUSE_FILE = join(homedir(), ".local/state/winnow-capture/paused-until");

const args = process.argv.slice(2);
const maxAt = args.indexOf("--max");
const max = maxAt >= 0 ? Number(args[maxAt + 1]) : Infinity;
if (maxAt >= 0) args.splice(maxAt, 2);
const ids = args.includes("--capture") ? captureVideos().filter((v) => !v.isLive).map((v) => v.id) : args;
if (ids.length === 0 || !(max > 0)) {
  console.log("usage: capture-transcripts.ts --capture | <videoId>... [--max N]");
  process.exit(1);
}
const pausedUntil = existsSync(PAUSE_FILE) ? new Date(readFileSync(PAUSE_FILE, "utf8").trim()) : null;
if (pausedUntil && pausedUntil.getTime() > Date.now()) {
  console.log(`Paused after a YouTube block until ${pausedUntil.toISOString()} (${PAUSE_FILE}); fetching nothing.`);
  process.exit(0);
}
const todo = ids.filter((id) => !isStored(id));
const batch = todo.slice(0, max);
console.log(`${ids.length - todo.length}/${ids.length} already stored; fetching ${batch.length} of ${todo.length}, one per ${PACE_MS / 1000} s, into ${TRANSCRIPT_STORE}`);
for (const [i, id] of batch.entries()) {
  if (i > 0) await new Promise((r) => setTimeout(r, PACE_MS));
  const outcome = await storedExcerpt(id, ENRICH_TRANSCRIPT_CHARS, { live: true });
  if ("excerpt" in outcome) {
    console.log(`${id}: transcript, ${outcome.excerpt.length} chars`);
    continue;
  }
  console.log(`${id}: ${outcome.failure}`);
  if (isYouTubeBlock(outcome.failure)) {
    const until = new Date(Date.now() + PAUSE_MS).toISOString();
    mkdirSync(join(PAUSE_FILE, ".."), { recursive: true });
    writeFileSync(PAUSE_FILE, `${until}\n`);
    console.log(`YouTube is blocking this network; stopping, and pausing all runs until ${until}. Stored videos are kept.`);
    break;
  }
}
