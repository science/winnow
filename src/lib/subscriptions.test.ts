import { describe, it, expect } from "vitest";
import { proxySubscribedChannels, subscribedIdSet } from "./subscriptions";
import type { SubscribedChannel, Video } from "./types";

function video(id: string, over: Partial<Video> = {}): Video {
  return {
    id,
    source: "subscriptions",
    title: `Video ${id}`,
    channelTitle: "Some Channel",
    channelId: "UCsome",
    durationText: null,
    durationSec: null,
    publishedText: null,
    publishedAtApprox: null,
    viewCountText: null,
    viewCount: null,
    thumbnailUrl: null,
    descriptionSnippet: null,
    isLive: false,
    ...over,
  };
}

describe("proxySubscribedChannels — degraded fallback when /feed/channels fails", () => {
  it("should derive channels from subscriptions-sourced videos only", () => {
    const channels = proxySubscribedChannels([
      video("a", { channelId: "UCsubbed", channelTitle: "Subbed", source: "subscriptions" }),
      video("b", { channelId: "UCrecommended", channelTitle: "Rec", source: "home" }),
      video("c", { channelId: "UCdiscovered", channelTitle: "Disc", source: "search" }),
    ]);
    expect(channels).toEqual([{ channelId: "UCsubbed", channelTitle: "Subbed" }]);
  });

  it("should skip videos with no channelId", () => {
    expect(proxySubscribedChannels([video("a", { channelId: null })])).toEqual([]);
  });

  it("should dedupe channels appearing across several videos, keeping the first title", () => {
    const channels = proxySubscribedChannels([
      video("a", { channelId: "UCdup", channelTitle: "First" }),
      video("b", { channelId: "UCdup", channelTitle: "Second" }),
    ]);
    expect(channels).toHaveLength(1);
    expect(channels[0]!.channelTitle).toBe("First");
  });

  it("should return an empty list for an empty feed", () => {
    expect(proxySubscribedChannels([])).toEqual([]);
  });
});

describe("subscribedIdSet", () => {
  it("should collect channel ids into a set", () => {
    const channels: SubscribedChannel[] = [
      { channelId: "UCone", channelTitle: "One" },
      { channelId: "UCtwo", channelTitle: null },
    ];
    const set = subscribedIdSet(channels);
    expect(set.has("UCone")).toBe(true);
    expect(set.has("UCtwo")).toBe(true);
    expect(set.has("UCthree")).toBe(false);
    expect(set.size).toBe(2);
  });

  it("should be empty for no channels", () => {
    expect(subscribedIdSet([]).size).toBe(0);
  });
});
