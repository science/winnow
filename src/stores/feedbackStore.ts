// Per-video user verdicts (Good pick / Not for me). Wolfechat pattern:
// load once, persist explicitly at the mutation site. NEVER pruned with the
// video window — votes must outlive the 300-cap feed to keep teaching
// future scoring runs (the store is bounded by FEEDBACK_STORE_CAP instead).

import { get, writable } from "svelte/store";
import type { FeedbackEntry, ScoredVideo, Vote } from "../lib/types";
import { applyVote } from "../lib/feedback";
import { KEYS, storageGet, storageSet } from "../lib/storage";

export const feedback = writable<Record<string, FeedbackEntry>>({});

export const feedbackReady: Promise<void> = (async () => {
  const stored = await storageGet<Record<string, FeedbackEntry>>(KEYS.feedback);
  if (stored) feedback.set(stored);
})();

/** Record a vote (or clear it, when the same vote repeats) with a snapshot
 * of the video's display fields and current score. */
export async function toggleVote(video: ScoredVideo, vote: Vote): Promise<void> {
  await feedbackReady;
  const scored = video.scoreState === "scored";
  const entry: FeedbackEntry = {
    videoId: video.id,
    vote,
    votedAt: Date.now(),
    title: video.title,
    channelTitle: video.channelTitle,
    durationText: video.durationText,
    source: video.source,
    descriptionSnippet: video.descriptionSnippet,
    score: scored ? (video.score ?? null) : null,
    reason: scored ? (video.reason ?? null) : null,
    clickbait: scored ? (video.clickbait ?? null) : null,
  };
  const next = applyVote(get(feedback), entry);
  feedback.set(next);
  await storageSet(KEYS.feedback, next);
}
