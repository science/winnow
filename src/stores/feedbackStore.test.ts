import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { feedback, toggleVote } from "./feedbackStore";
import { profilesState } from "./profilesStore";
import { profileKeys, storageGet } from "../lib/storage";
import type { FeedbackEntry, ScoredVideo } from "../lib/types";

async function activeFeedbackKey(): Promise<string> {
  return profileKeys(get(profilesState).activeProfileId).feedback;
}

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

    const stored = await storageGet<Record<string, FeedbackEntry>>(await activeFeedbackKey());
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

describe("per-profile votes", () => {
  // Fresh module graph per test: vote isolation depends on which profile is
  // active at load time, so each scenario boots its own stores.
  beforeEach(() => {
    vi.resetModules();
  });

  it("should keep votes isolated per profile and reload them on demand", async () => {
    const storage = await import("../lib/storage");
    const fbStore = await import("./feedbackStore");
    const profiles = await import("./profilesStore");
    await fbStore.feedbackReady;
    const defaultId = get(profiles.profilesState).activeProfileId;

    const vote = (id: string): ScoredVideo => ({
      ...{
        id,
        source: "home" as const,
        title: id,
        channelTitle: null,
        channelId: null,
        durationText: null,
        durationSec: null,
        publishedText: null,
        publishedAtApprox: null,
        viewCountText: null,
        viewCount: null,
        thumbnailUrl: null,
        descriptionSnippet: null,
        isLive: false,
      },
      scoreState: "unknown" as const,
    });

    await fbStore.toggleVote(vote("defaultvote1"), "up");

    const secondId = await profiles.addProfileAction("Engineering");
    await fbStore.reloadFeedback(secondId);
    expect(get(fbStore.feedback)).toEqual({});

    await fbStore.toggleVote(vote("secondvote01"), "down");
    const secondStored = await storage.storageGet<Record<string, FeedbackEntry>>(
      storage.profileKeys(secondId).feedback,
    );
    expect(Object.keys(secondStored!)).toEqual(["secondvote01"]);

    await fbStore.reloadFeedback(defaultId);
    expect(Object.keys(get(fbStore.feedback))).toEqual(["defaultvote1"]);
    const defaultStored = await storage.storageGet<Record<string, FeedbackEntry>>(
      storage.profileKeys(defaultId).feedback,
    );
    expect(Object.keys(defaultStored!)).toEqual(["defaultvote1"]);
  });
});
