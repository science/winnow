// Per-video user verdicts (Good pick / Not for me), PER PROFILE: votes teach
// the active profile's scoring only — a "boring" downvote in a leisure
// profile must not steer a work profile. Wolfechat pattern: load once,
// persist explicitly at the mutation site. NEVER pruned with the video
// window (bounded by FEEDBACK_STORE_CAP instead).

import { get, writable } from "svelte/store";
import type { FeedbackEntry, ScoredVideo, Vote } from "../lib/types";
import { applyVote } from "../lib/feedback";
import { profileKeys, storageGet, storageSet } from "../lib/storage";
import { profilesReady, profilesState } from "./profilesStore";

export const feedback = writable<Record<string, FeedbackEntry>>({});

/** The profile whose votes are currently loaded (and voted into). */
let loadedProfileId: string | null = null;

/** Swap the in-memory votes to another profile's persisted set. */
export async function reloadFeedback(profileId: string): Promise<void> {
  const stored = await storageGet<Record<string, FeedbackEntry>>(
    profileKeys(profileId).feedback,
  );
  loadedProfileId = profileId;
  feedback.set(stored ?? {});
}

export const feedbackReady: Promise<void> = (async () => {
  await profilesReady;
  await reloadFeedback(get(profilesState).activeProfileId);
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
  // Persist under the profile whose votes are loaded — not whatever is
  // active right now — so a vote landing during a switch can't cross over.
  const profileId = loadedProfileId ?? get(profilesState).activeProfileId;
  await storageSet(profileKeys(profileId).feedback, next);
}
