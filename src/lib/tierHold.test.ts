import { describe, it, expect } from "vitest";
import { freezeTiers } from "./tierHold";
import type { Tiers } from "./tiers";
import type { ScoredVideo } from "./types";

function video(id: string, overrides: Partial<ScoredVideo> = {}): ScoredVideo {
  return {
    id,
    source: "subscriptions",
    title: id,
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
    score: 80,
    clickbait: false,
    ...overrides,
  };
}

function tiers(t: Partial<Tiers> = {}): Tiers {
  return { top: [], worthALook: [], winnowed: [], unscored: [], ...t };
}

const ids = (list: ScoredVideo[]): string[] => list.map((v) => v.id);

describe("freezeTiers", () => {
  it("should pass live tiers through unchanged when nothing is held", () => {
    const live = tiers({ top: [video("aaaaaaaaaaa"), video("bbbbbbbbbbb")] });
    expect(freezeTiers(live, null)).toBe(live);
  });

  it("should keep a held video in its held tier after a downvote moves it live", () => {
    const held = tiers({ top: [video("aaaaaaaaaaa"), video("bbbbbbbbbbb")] });
    // A downvote re-buckets bbb into winnowed; the open player must not move.
    const live = tiers({ top: [video("aaaaaaaaaaa")], winnowed: [video("bbbbbbbbbbb")] });
    const frozen = freezeTiers(live, held);
    expect(ids(frozen.top)).toEqual(["aaaaaaaaaaa", "bbbbbbbbbbb"]);
    expect(ids(frozen.winnowed)).toEqual([]);
  });

  it("should keep held order when a watched video would sink to the tier's tail", () => {
    const held = tiers({ top: [video("aaaaaaaaaaa"), video("bbbbbbbbbbb"), video("ccccccccccc")] });
    const live = tiers({ top: [video("bbbbbbbbbbb"), video("ccccccccccc"), video("aaaaaaaaaaa")] });
    expect(ids(freezeTiers(live, held).top)).toEqual([
      "aaaaaaaaaaa",
      "bbbbbbbbbbb",
      "ccccccccccc",
    ]);
  });

  it("should refresh the video object so a score landing mid-hold still renders", () => {
    const held = tiers({
      unscored: [video("aaaaaaaaaaa", { scoreState: "pending", score: undefined })],
    });
    const live = tiers({ top: [video("aaaaaaaaaaa", { scoreState: "scored", score: 91 })] });
    const frozen = freezeTiers(live, held);
    expect(frozen.unscored[0]?.scoreState).toBe("scored");
    expect(frozen.unscored[0]?.score).toBe(91);
  });

  it("should drop a held video that left the feed window", () => {
    const held = tiers({ top: [video("aaaaaaaaaaa"), video("goneeeeeeee")] });
    const live = tiers({ top: [video("aaaaaaaaaaa")] });
    expect(ids(freezeTiers(live, held).top)).toEqual(["aaaaaaaaaaa"]);
  });

  it("should append newly scored videos to the tail of their live tier", () => {
    const held = tiers({ top: [video("aaaaaaaaaaa")] });
    const live = tiers({ top: [video("newwwwwwwww"), video("aaaaaaaaaaa")] });
    expect(ids(freezeTiers(live, held).top)).toEqual(["aaaaaaaaaaa", "newwwwwwwww"]);
  });

  it("should never render a video twice when it changed tier", () => {
    const held = tiers({ worthALook: [video("aaaaaaaaaaa")] });
    const live = tiers({ top: [video("aaaaaaaaaaa")] });
    const frozen = freezeTiers(live, held);
    const all = [...frozen.top, ...frozen.worthALook, ...frozen.winnowed, ...frozen.unscored];
    expect(ids(all)).toEqual(["aaaaaaaaaaa"]);
  });
});
