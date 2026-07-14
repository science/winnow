import { describe, expect, it } from "vitest";
import { applyVote, FEEDBACK_STORE_CAP, recentExamples } from "./feedback";
import type { FeedbackEntry, Vote } from "./types";

function entry(videoId: string, vote: Vote, votedAt: number, title = `Video ${videoId}`): FeedbackEntry {
  return {
    videoId,
    vote,
    votedAt,
    title,
    channelTitle: "Channel",
    durationText: "10:00",
    source: "home",
    descriptionSnippet: null,
    score: 42,
    reason: "meh",
    clickbait: false,
  };
}

describe("applyVote", () => {
  it("should record a vote", () => {
    const next = applyVote({}, entry("vid00000001", "down", 100));
    expect(next["vid00000001"]!.vote).toBe("down");
    expect(next["vid00000001"]!.title).toBe("Video vid00000001");
  });

  it("should toggle a vote off when the same vote repeats", () => {
    const store = applyVote({}, entry("vid00000001", "down", 100));
    const next = applyVote(store, entry("vid00000001", "down", 200));
    expect(next["vid00000001"]).toBeUndefined();
  });

  it("should replace an opposite vote", () => {
    const store = applyVote({}, entry("vid00000001", "down", 100));
    const next = applyVote(store, entry("vid00000001", "up", 200));
    expect(next["vid00000001"]!.vote).toBe("up");
    expect(next["vid00000001"]!.votedAt).toBe(200);
  });

  it("should evict the oldest entries beyond the cap", () => {
    let store: Record<string, FeedbackEntry> = {};
    for (let i = 0; i < FEEDBACK_STORE_CAP + 5; i++) {
      store = applyVote(store, entry(`vid${String(i).padStart(8, "0")}`, "up", i));
    }
    expect(Object.keys(store)).toHaveLength(FEEDBACK_STORE_CAP);
    expect(store["vid00000000"]).toBeUndefined();
    expect(store[`vid${String(FEEDBACK_STORE_CAP + 4).padStart(8, "0")}`]).toBeDefined();
  });
});

describe("recentExamples", () => {
  it("should select the most recent N examples per direction, newest first", () => {
    let store: Record<string, FeedbackEntry> = {};
    for (let i = 0; i < 5; i++) store = applyVote(store, entry(`upvid000000${i}`, "up", i));
    for (let i = 0; i < 5; i++) store = applyVote(store, entry(`downvid0000${i}`, "down", 10 + i));

    const examples = recentExamples(store, 2);
    expect(examples).toHaveLength(4);
    expect(examples.filter((e) => e.vote === "up").map((e) => e.title)).toEqual([
      "Video upvid0000004",
      "Video upvid0000003",
    ]);
    expect(examples.filter((e) => e.vote === "down").map((e) => e.title)).toEqual([
      "Video downvid00004",
      "Video downvid00003",
    ]);
  });

  it("should describe examples with title, channel, and duration", () => {
    const store = applyVote({}, entry("vid00000001", "down", 100));
    expect(recentExamples(store, 5)).toEqual([
      { vote: "down", title: "Video vid00000001", channel: "Channel", duration: "10:00" },
    ]);
  });
});
