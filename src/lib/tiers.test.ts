import { describe, it, expect } from "vitest";
import { bucketVideos, scoresCollapse, TIER_THRESHOLDS } from "./tiers";
import type { ScoredVideo } from "./types";

function video(overrides: Partial<ScoredVideo>): ScoredVideo {
  return {
    id: Math.random().toString(36).slice(2, 13),
    source: "subscriptions",
    title: "t",
    channelTitle: "c",
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
    scoreState: "scored",
    score: 50,
    clickbait: false,
    ...overrides,
  };
}

describe("bucketVideos", () => {
  it("should put high-scoring non-clickbait in top picks", () => {
    const tiers = bucketVideos([video({ score: 80 })]);
    expect(tiers.top).toHaveLength(1);
  });

  it("should demote clickbait-flagged high scorers to worth-a-look", () => {
    const tiers = bucketVideos([video({ score: 90, clickbait: true })]);
    expect(tiers.top).toHaveLength(0);
    expect(tiers.worthALook).toHaveLength(1);
  });

  it("should bucket mid scores as worth-a-look and low scores as winnowed", () => {
    const tiers = bucketVideos([video({ score: 60 }), video({ score: 20 })]);
    expect(tiers.worthALook).toHaveLength(1);
    expect(tiers.winnowed).toHaveLength(1);
  });

  it("should respect the documented thresholds at their boundaries", () => {
    const tiers = bucketVideos([
      video({ score: TIER_THRESHOLDS.top }),
      video({ score: TIER_THRESHOLDS.top - 1 }),
      video({ score: TIER_THRESHOLDS.worthALook }),
      video({ score: TIER_THRESHOLDS.worthALook - 1 }),
    ]);
    expect(tiers.top).toHaveLength(1);
    expect(tiers.worthALook).toHaveLength(2);
    expect(tiers.winnowed).toHaveLength(1);
  });

  it("should collect pending and unknown videos in unscored", () => {
    const tiers = bucketVideos([
      video({ scoreState: "pending", score: undefined }),
      video({ scoreState: "unknown", score: undefined }),
    ]);
    expect(tiers.unscored).toHaveLength(2);
  });

  it("should sort each tier newest-first with unknown ages last", () => {
    const now = Date.now();
    const tiers = bucketVideos([
      video({ score: 80, id: "old00000000", publishedAtApprox: now - 100_000 }),
      video({ score: 80, id: "ageless0000", publishedAtApprox: null }),
      video({ score: 80, id: "new00000000", publishedAtApprox: now - 1_000 }),
    ]);
    expect(tiers.top.map((v) => v.id)).toEqual(["new00000000", "old00000000", "ageless0000"]);
  });

  it("should sink watched videos to the bottom of their tier", () => {
    const now = Date.now();
    const tiers = bucketVideos(
      [
        video({ score: 80, id: "watched0000", publishedAtApprox: now - 1_000 }),
        video({ score: 80, id: "unwatched00", publishedAtApprox: now - 100_000 }),
      ],
      new Set(["watched0000"]),
    );
    expect(tiers.top.map((v) => v.id)).toEqual(["unwatched00", "watched0000"]);
  });

  it("should demote a downvoted video to winnowed regardless of score", () => {
    const tiers = bucketVideos([video({ score: 95, id: "downvoted00" })], new Set(), {
      downvoted00: { vote: "down", votedAt: 1 },
    });
    expect(tiers.winnowed.map((v) => v.id)).toEqual(["downvoted00"]);
    expect(tiers.top).toHaveLength(0);
  });

  it("should promote an upvoted video to top picks even when scored low or clickbait", () => {
    const tiers = bucketVideos(
      [
        video({ score: 10, id: "lowscore000" }),
        video({ score: 90, clickbait: true, id: "baityfave00" }),
      ],
      new Set(),
      { lowscore000: { vote: "up", votedAt: 1 }, baityfave00: { vote: "up", votedAt: 2 } },
    );
    expect(tiers.top.map((v) => v.id).sort()).toEqual(["baityfave00", "lowscore000"]);
    expect(tiers.winnowed).toHaveLength(0);
    expect(tiers.worthALook).toHaveLength(0);
  });

  it("should place an upvoted unscored video in top picks", () => {
    const tiers = bucketVideos(
      [video({ scoreState: "unknown", score: undefined, id: "unvetted001" })],
      new Set(),
      { unvetted001: { vote: "up", votedAt: 1 } },
    );
    expect(tiers.top.map((v) => v.id)).toEqual(["unvetted001"]);
    expect(tiers.unscored).toHaveLength(0);
  });

  it("should sort upvoted videos ahead of others within top picks, most recent vote first", () => {
    const now = Date.now();
    const tiers = bucketVideos(
      [
        video({ score: 90, id: "unvoted0000", publishedAtApprox: now }),
        video({ score: 80, id: "earlyvote00", publishedAtApprox: now - 100_000 }),
        video({ score: 80, id: "latevote000", publishedAtApprox: now - 200_000 }),
      ],
      new Set(),
      { earlyvote00: { vote: "up", votedAt: 100 }, latevote000: { vote: "up", votedAt: 200 } },
    );
    expect(tiers.top.map((v) => v.id)).toEqual(["latevote000", "earlyvote00", "unvoted0000"]);
  });

  it("should leave unvoted videos in their score tiers", () => {
    const tiers = bucketVideos(
      [video({ score: 80, id: "plainhigh00" }), video({ score: 20, id: "plainlow000" })],
      new Set(),
      { someoneelse: { vote: "down", votedAt: 1 } },
    );
    expect(tiers.top.map((v) => v.id)).toEqual(["plainhigh00"]);
    expect(tiers.winnowed.map((v) => v.id)).toEqual(["plainlow000"]);
  });
});

describe("scoresCollapse", () => {
  it("should detect when scoring failed to differentiate (all one tier)", () => {
    const all75 = Array.from({ length: 10 }, () => video({ score: 80 }));
    expect(scoresCollapse(all75)).toBe(true);
  });

  it("should not fire on a differentiated feed", () => {
    const mixed = [video({ score: 90 }), video({ score: 60 }), video({ score: 10 })];
    expect(scoresCollapse(mixed)).toBe(false);
  });

  it("should not fire on tiny or unscored feeds", () => {
    expect(scoresCollapse([video({ score: 80 })])).toBe(false);
    expect(scoresCollapse(Array.from({ length: 10 }, () => video({ scoreState: "pending", score: undefined })))).toBe(false);
  });
});
