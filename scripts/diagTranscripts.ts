// Transcript fetcher for diag scripts. Bulk diag runs from the home network
// once got the household IP a Google "automated queries" block, which also
// cut off the user's own Winnow. So scripts fetch each video at most once,
// ever (successes and no-caption answers are kept in .diag-cache/, gitignored),
// and stop going to YouTube after DIAG_TRANSCRIPT_BUDGET live fetches
// (default 20) per process.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchTranscriptExcerpt, type TranscriptOutcome } from "../src/services/youtube/transcripts";

const CACHE = join(dirname(fileURLToPath(import.meta.url)), "..", ".diag-cache", "transcripts.json");
const BUDGET = Number(process.env["DIAG_TRANSCRIPT_BUDGET"] ?? 20);

type Entry = { maxChars: number; outcome: TranscriptOutcome };
let cache: Record<string, Entry> | null = null;
let liveFetches = 0;

function load(): Record<string, Entry> {
  cache ??= existsSync(CACHE) ? (JSON.parse(readFileSync(CACHE, "utf8")) as Record<string, Entry>) : {};
  return cache;
}

export async function diagFetchExcerpt(videoId: string, maxChars: number): Promise<TranscriptOutcome> {
  const c = load();
  const hit = c[videoId];
  if (hit && ("failure" in hit.outcome || hit.maxChars >= maxChars || hit.outcome.excerpt.length < hit.maxChars)) {
    return "excerpt" in hit.outcome ? { ...hit.outcome, excerpt: hit.outcome.excerpt.slice(0, maxChars) } : hit.outcome;
  }
  if (liveFetches >= BUDGET) return { failure: "diag-budget-spent" };
  liveFetches++;
  const outcome = await fetchTranscriptExcerpt(videoId, maxChars);
  if ("excerpt" in outcome || outcome.failure === "no-tracks") {
    c[videoId] = { maxChars, outcome };
    mkdirSync(dirname(CACHE), { recursive: true });
    writeFileSync(CACHE, JSON.stringify(c));
  }
  return outcome;
}

export function diagTranscriptStats(): string {
  return `${liveFetches} live transcript fetches this run (budget ${BUDGET}); cache ${CACHE}`;
}
