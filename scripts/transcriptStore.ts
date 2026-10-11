// Local transcript fixtures for dev tooling. Bulk fetching from the home
// network once got the household IP a Google "automated queries" block,
// which also cut off the user's own Winnow (docs/DEVELOPMENT.md invariants).
// So tools read transcripts from local-fixtures/transcripts.json and never
// touch YouTube; a video missing from the store is scored from metadata.
// Only scripts/capture-transcripts.ts (bulk, paced, by hand) and single-video
// tools that pass { live: true } fetch, and each stored video is fetched
// once, ever. The file is gitignored: the repo is public, and transcripts are
// the creators' text.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchTranscriptExcerpt, type TranscriptOutcome } from "../src/services/youtube/transcripts";

export const TRANSCRIPT_STORE = join(dirname(fileURLToPath(import.meta.url)), "..", "local-fixtures", "transcripts.json");

type Entry = { maxChars: number; outcome: TranscriptOutcome; fetchedAt: string };
let store: Record<string, Entry> | null = null;

function load(): Record<string, Entry> {
  store ??= existsSync(TRANSCRIPT_STORE) ? (JSON.parse(readFileSync(TRANSCRIPT_STORE, "utf8")) as Record<string, Entry>) : {};
  return store;
}

export function isStored(videoId: string): boolean {
  return videoId in load();
}

export async function storedExcerpt(
  videoId: string,
  maxChars: number,
  opts: { live?: boolean } = {},
): Promise<TranscriptOutcome> {
  const s = load();
  const hit = s[videoId];
  if (hit) {
    return "excerpt" in hit.outcome ? { ...hit.outcome, excerpt: hit.outcome.excerpt.slice(0, maxChars) } : hit.outcome;
  }
  if (!opts.live) return { failure: "not-in-store" };
  const outcome = await fetchTranscriptExcerpt(videoId, maxChars);
  // Keep answers that won't change; 429s, timeouts and network errors stay unstored.
  if ("excerpt" in outcome || outcome.failure === "no-tracks") {
    s[videoId] = { maxChars, outcome, fetchedAt: new Date().toISOString() };
    mkdirSync(dirname(TRANSCRIPT_STORE), { recursive: true });
    writeFileSync(TRANSCRIPT_STORE, JSON.stringify(s));
  }
  return outcome;
}

/** Offline transcript source in runTwoPhaseScoring's `fetchExcerpt` shape. */
export const offlineFetchExcerpt = (videoId: string, maxChars: number): Promise<TranscriptOutcome> =>
  storedExcerpt(videoId, maxChars);
