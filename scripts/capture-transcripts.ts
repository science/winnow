// Fill the local transcript store (scripts/transcriptStore.ts) — the ONLY
// bulk YouTube transcript fetch in the repo, and it's run by hand. Videos
// already stored are skipped, so each is fetched once, ever. Paced 4 s apart;
// stops at the first 429 (Google's IP-wide block also cuts off the user's own
// Winnow, and every further request extends it). More than a few dozen new
// videos needs the user's OK, or a network other than the household's.
//
//   npx vite-node scripts/capture-transcripts.ts --capture   # the 126-video gotham capture
//   npx vite-node scripts/capture-transcripts.ts <videoId>...
import { ENRICH_TRANSCRIPT_CHARS } from "../src/services/scoring/enrichPrompt";
import { captureVideos } from "./captureFixture";
import { isStored, storedExcerpt, TRANSCRIPT_STORE } from "./transcriptStore";

const PACE_MS = 4000;
const args = process.argv.slice(2);
const ids = args.includes("--capture") ? captureVideos().filter((v) => !v.isLive).map((v) => v.id) : args;
if (ids.length === 0) {
  console.log("usage: capture-transcripts.ts --capture | <videoId>...");
  process.exit(1);
}
const todo = ids.filter((id) => !isStored(id));
console.log(`${ids.length - todo.length}/${ids.length} already stored; fetching ${todo.length} at one per ${PACE_MS / 1000} s into ${TRANSCRIPT_STORE}`);
let got = 0;
for (const [i, id] of todo.entries()) {
  if (i > 0) await new Promise((r) => setTimeout(r, PACE_MS));
  const outcome = await storedExcerpt(id, ENRICH_TRANSCRIPT_CHARS, { live: true });
  if ("excerpt" in outcome) got++;
  else if (outcome.failure.endsWith("-http-429")) {
    console.log(`\nYouTube answered 429 (${outcome.failure}): this network is rate-limited; stopping. Rerun later — stored videos are kept.`);
    break;
  }
  process.stdout.write(`\r${i + 1}/${todo.length} tried, ${got} transcripts stored `);
}
console.log();
