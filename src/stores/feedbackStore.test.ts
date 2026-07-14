import { describe, expect, it } from "vitest";
import { get } from "svelte/store";
import { feedback, toggleVote } from "./feedbackStore";
import { KEYS, storageGet } from "../lib/storage";
import type { FeedbackEntry, ScoredVideo } from "../lib/types";

function scoredVideo(id: string): ScoredVideo {
  return {
    id,
    source: "home",
    title: `Video ${id}`,
    channelTitle: "Some Channel",
    channelId: null,
    durationText: "8:01",
    durationSec: 481,
    publishedText: "1 day ago",
    publishedAtApprox: null,
    viewCountText: null,
    viewCount: null,
    thumbnailUrl: null,
    descriptionSnippet: "a snippet",
    isLive: false,
    scoreState: "scored",
    score: 88,
    reason: "matches your interests",
    clickbait: false,
  };
}

describe("toggleVote", () => {
  it("should record a vote with a snapshot of the video and persist it", async () => {
    await toggleVote(scoredVideo("snapshotme1"), "down");

    const entry = get(feedback)["snapshotme1"]!;
    expect(entry.vote).toBe("down");
    expect(entry.title).toBe("Video snapshotme1");
    expect(entry.channelTitle).toBe("Some Channel");
    expect(entry.durationText).toBe("8:01");
    expect(entry.score).toBe(88);
    expect(entry.reason).toBe("matches your interests");
    expect(entry.clickbait).toBe(false);

    const stored = await storageGet<Record<string, FeedbackEntry>>(KEYS.feedback);
    expect(stored!["snapshotme1"]!.vote).toBe("down");
  });

  it("should record null score fields for an unscored video", async () => {
    const unscored: ScoredVideo = { ...scoredVideo("unscoredvid"), scoreState: "unknown", score: undefined, reason: undefined, clickbait: undefined };
    await toggleVote(unscored, "up");
    const entry = get(feedback)["unscoredvid"]!;
    expect(entry.score).toBeNull();
    expect(entry.reason).toBeNull();
    expect(entry.clickbait).toBeNull();
  });

  it("should clear the vote when the same vote is toggled again", async () => {
    await toggleVote(scoredVideo("togglemeoff"), "up");
    await toggleVote(scoredVideo("togglemeoff"), "up");
    expect(get(feedback)["togglemeoff"]).toBeUndefined();
  });
});
