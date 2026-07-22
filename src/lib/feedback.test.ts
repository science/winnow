import { describe, expect, it } from "vitest";
import { applyVote, FEEDBACK_STORE_CAP, recentExamples } from "./feedback";
import type { FeedbackEntry, VideoDigest, Vote } from "./types";

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

const DIGEST: VideoDigest = {
  summary: "Two famous streamers play casual banter chess.",
  topics: ["casual chess", "comedic chess", "chess"],
  format: "entertainment",
  emotionalTone: "humorous",
  hypeSignals: ["all-caps title"],
  substanceDensity: 2,
  clickbaitSeverity: 2,
  claimOverreach: 1,
  intellectualDemand: 1,
  productionEffort: 3,
  novelty: 2,
};

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

  it("should include a compact digest when its snapshot matches the current prompt version", () => {
    // The digest puts the vote in the same coordinates the translator emits
    // into ("down: casual chess" beats guessing from a bare title). Summary
    // and hypeSignals stay out — prompt lean, topics carry the signal.
    const store = applyVote({}, {
      ...entry("vid00000001", "down", 100),
      digest: DIGEST,
      digestPromptVersion: 3,
    });
    const [example] = recentExamples(store, 5, 3);
    expect(example!.digest).toEqual({
      topics: ["casual chess", "comedic chess", "chess"],
      format: "entertainment",
      tone: "humorous",
      substanceDensity: 2,
      clickbaitSeverity: 2,
      claimOverreach: 1,
      intellectualDemand: 1,
      productionEffort: 3,
      novelty: 2,
    });
  });

  it("should omit the digest for votes without one or from another prompt version", () => {
    // A snapshot from an older enrichment prompt may carry exactly the
    // mislabel the newer prompt fixed (the Tyler1/Faker "elite chess"
    // digest) — teaching the translator from it would entrench the bug.
    const legacy = entry("vid00000001", "down", 100);
    const stale = { ...entry("vid00000002", "down", 200), digest: DIGEST, digestPromptVersion: 2 };
    const store = applyVote(applyVote({}, legacy), stale);
    for (const example of recentExamples(store, 5, 3)) {
      expect(example.digest).toBeUndefined();
    }
  });

  it("should never include digests when no prompt version is given", () => {
    const store = applyVote({}, { ...entry("vid00000001", "up", 100), digest: DIGEST, digestPromptVersion: 3 });
    expect(recentExamples(store, 5)[0]!.digest).toBeUndefined();
  });
});
