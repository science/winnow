// Pure vote bookkeeping: applying/toggling votes with a bounded store, and
// selecting recent examples for the scoring prompt.

import { DIGEST_NUMERIC_FIELDS, type DigestNumericField, type FeedbackEntry, type VideoDigest, type Vote } from "./types";

export const FEEDBACK_STORE_CAP = 200;

/** The voted video's digest in the coordinates the translator emits into —
 * topics carry the signal; summary/hypeSignals stay out to keep prompts
 * lean. */
export type FeedbackExampleDigest = Record<DigestNumericField, number> & {
  topics: string[];
  format: string;
  tone: string;
};

/** Compact form of a voted video as it appears in the scoring prompt. */
export interface FeedbackExample {
  vote: Vote;
  title: string;
  channel: string;
  duration: string;
  digest?: FeedbackExampleDigest;
}

function compactDigest(digest: VideoDigest): FeedbackExampleDigest {
  const numerics = Object.fromEntries(
    DIGEST_NUMERIC_FIELDS.map((f) => [f, digest[f]]),
  ) as Record<DigestNumericField, number>;
  return { topics: digest.topics, format: digest.format, tone: digest.emotionalTone, ...numerics };
}

/**
 * Apply one vote. Repeating the same vote toggles it off; an opposite vote
 * replaces it. Beyond `cap` entries, the oldest votes are evicted.
 */
export function applyVote(
  store: Record<string, FeedbackEntry>,
  entry: FeedbackEntry,
  cap: number = FEEDBACK_STORE_CAP,
): Record<string, FeedbackEntry> {
  if (store[entry.videoId]?.vote === entry.vote) {
    const { [entry.videoId]: _removed, ...rest } = store;
    return rest;
  }
  const next = { ...store, [entry.videoId]: entry };
  const entries = Object.values(next);
  if (entries.length <= cap) return next;
  entries.sort((a, b) => b.votedAt - a.votedAt);
  return Object.fromEntries(entries.slice(0, cap).map((e) => [e.videoId, e]));
}

/** The most recent `perDirection` up-votes and down-votes, newest first.
 * Digest snapshots ride along only when they were produced by
 * `digestPromptVersion` — an older prompt's digest may carry the very
 * mislabel the current prompt fixed, and a wrong label teaches worse than
 * no label. */
export function recentExamples(
  store: Record<string, FeedbackEntry>,
  perDirection: number,
  digestPromptVersion?: number,
): FeedbackExample[] {
  const entries = Object.values(store).sort((a, b) => b.votedAt - a.votedAt);
  const counts: Record<Vote, number> = { up: 0, down: 0 };
  const examples: FeedbackExample[] = [];
  for (const e of entries) {
    if (counts[e.vote] >= perDirection) continue;
    counts[e.vote]++;
    const digestCurrent =
      e.digest != null &&
      digestPromptVersion !== undefined &&
      e.digestPromptVersion === digestPromptVersion;
    examples.push({
      vote: e.vote,
      title: e.title,
      channel: e.channelTitle ?? "unknown",
      duration: e.durationText ?? "unknown",
      ...(digestCurrent ? { digest: compactDigest(e.digest!) } : {}),
    });
  }
  return examples;
}
