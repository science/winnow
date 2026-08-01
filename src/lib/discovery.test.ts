import { describe, expect, it } from "vitest";
import type { Video } from "./types";
import {
  buildQueryPool,
  DISCOVERED_CAP,
  markQueriesUsed,
  mergeDiscovered,
  pickQueries,
  QUERIES_PER_RUN,
  QUERY_POOL_MAX,
  PER_CHANNEL_RUN_CAP,
  SEEN_IDS_CAP,
  type DiscoveredState,
} from "./discovery";

function video(id: string): Video {
  return {
    id,
    source: "search",
    title: `Video ${id}`,
    channelTitle: "c",
    channelId: null,
    durationText: "10:00",
    durationSec: 600,
    publishedText: null,
    publishedAtApprox: null,
    viewCountText: null,
    viewCount: null,
    thumbnailUrl: null,
    descriptionSnippet: null,
    isLive: false,
  };
}

const found = (id: string, query = "q") => ({ video: video(id), query });

const emptyState: DiscoveredState = { entries: [], seenIds: [] };

describe("buildQueryPool", () => {
  it("should trim, dedupe case-insensitively, and cap the pool", () => {
    const raw = [
      "  kpop stage mix  ",
      "Kpop Stage Mix",
      "",
      ...Array.from({ length: 20 }, (_unused, i) => `query ${i}`),
    ];
    const pool = buildQueryPool(raw);
    expect(pool.length).toBe(QUERY_POOL_MAX);
    expect(pool[0]).toEqual({ text: "kpop stage mix", lastUsedAt: 0 });
    expect(pool.filter((q) => q.text.toLowerCase() === "kpop stage mix")).toHaveLength(1);
  });
});

describe("pickQueries", () => {
  it("should pick never-used queries first, then the least recently used", () => {
    const pool = [
      { text: "used recently", lastUsedAt: 300 },
      { text: "never used a", lastUsedAt: 0 },
      { text: "used long ago", lastUsedAt: 100 },
      { text: "never used b", lastUsedAt: 0 },
    ];
    expect(pickQueries(pool, 3)).toEqual(["never used a", "never used b", "used long ago"]);
  });

  it("should return at most n queries and default to QUERIES_PER_RUN", () => {
    const pool = Array.from({ length: 12 }, (_unused, i) => ({ text: `q${i}`, lastUsedAt: 0 }));
    expect(pickQueries(pool)).toHaveLength(QUERIES_PER_RUN);
    expect(pickQueries(pool, 3)).toHaveLength(3);
    expect(pickQueries(pool.slice(0, 2), 5)).toHaveLength(2);
  });
});

describe("markQueriesUsed", () => {
  it("should stamp lastUsedAt only on the used queries", () => {
    const pool = [
      { text: "a", lastUsedAt: 0 },
      { text: "b", lastUsedAt: 0 },
    ];
    const next = markQueriesUsed(pool, ["a"], 500);
    expect(next).toEqual([
      { text: "a", lastUsedAt: 500 },
      { text: "b", lastUsedAt: 0 },
    ]);
  });
});

describe("mergeDiscovered", () => {
  it("should add fresh videos and record them as seen", () => {
    const { state, added } = mergeDiscovered(
      emptyState,
      [found("newvideo0001"), found("newvideo0002")],
      new Set(),
      100,
    );
    expect(added).toBe(2);
    expect(state.entries.map((e) => e.video.id)).toEqual(["newvideo0001", "newvideo0002"]);
    expect(state.entries[0]).toMatchObject({ query: "q", discoveredAt: 100 });
    expect(state.seenIds).toEqual(["newvideo0001", "newvideo0002"]);
  });

  it("should drop videos already in the feed, already seen, or repeated in-run", () => {
    const prior: DiscoveredState = { entries: [], seenIds: ["seenbefore01"] };
    const { state, added } = mergeDiscovered(
      prior,
      [
        found("infeedvideo1"),
        found("seenbefore01"),
        found("fresh0000001"),
        found("fresh0000001"),
      ],
      new Set(["infeedvideo1"]),
      100,
    );
    expect(added).toBe(1);
    expect(state.entries.map((e) => e.video.id)).toEqual(["fresh0000001"]);
  });

  it("should evict the oldest entries beyond the cap without shrinking seenIds", () => {
    const prior: DiscoveredState = {
      entries: Array.from({ length: DISCOVERED_CAP }, (_u, i) => ({
        video: video(`old${i}`),
        query: "q",
        discoveredAt: i,
      })),
      seenIds: Array.from({ length: DISCOVERED_CAP }, (_u, i) => `old${i}`),
    };
    const { state } = mergeDiscovered(prior, [found("brandnew0001")], new Set(), 9999);
    expect(state.entries).toHaveLength(DISCOVERED_CAP);
    expect(state.entries.some((e) => e.video.id === "old0")).toBe(false);
    expect(state.entries.at(-1)!.video.id).toBe("brandnew0001");
    // The evicted video stays seen — it must never be re-discovered.
    expect(state.seenIds).toContain("old0");
    expect(state.seenIds).toContain("brandnew0001");
  });

  it("should cap seenIds FIFO at SEEN_IDS_CAP", () => {
    const prior: DiscoveredState = {
      entries: [],
      seenIds: Array.from({ length: SEEN_IDS_CAP }, (_u, i) => `seen${i}`),
    };
    const { state } = mergeDiscovered(prior, [found("overflow0001")], new Set(), 100);
    expect(state.seenIds).toHaveLength(SEEN_IDS_CAP);
    expect(state.seenIds).not.toContain("seen0");
    expect(state.seenIds).toContain("overflow0001");
  });
});

describe("mergeDiscovered — channel awareness", () => {
  const chanVideo = (id: string, channelId: string | null, query = "q") => ({
    video: { ...video(id), channelId },
    query,
  });

  it("should mark discoveries from channels the user already subscribes to", () => {
    const { state } = mergeDiscovered(
      emptyState,
      [chanVideo("subbedvid01", "UCsubbed"), chanVideo("freshvid001", "UCnew")],
      new Set(),
      1000,
      new Set(["UCsubbed"]),
    );
    const bySubscribed = Object.fromEntries(
      state.entries.map((e) => [e.video.id, e.alreadySubscribed]),
    );
    expect(bySubscribed["subbedvid01"]).toBe(true);
    expect(bySubscribed["freshvid001"]).toBe(false);
  });

  it("should keep already-subscribed discoveries rather than dropping them", () => {
    const { state, added } = mergeDiscovered(
      emptyState,
      [chanVideo("subbedvid01", "UCsubbed")],
      new Set(),
      1000,
      new Set(["UCsubbed"]),
    );
    expect(added).toBe(1);
    expect(state.entries).toHaveLength(1);
  });

  it("should treat a null channelId as not subscribed instead of throwing", () => {
    const { state } = mergeDiscovered(
      emptyState,
      [chanVideo("nochanvid01", null)],
      new Set(),
      1000,
      new Set(["UCsubbed"]),
    );
    expect(state.entries[0]!.alreadySubscribed).toBe(false);
  });

  it("should default to not-subscribed when no set is supplied", () => {
    const { state } = mergeDiscovered(emptyState, [found("plainvid001")], new Set(), 1000);
    expect(state.entries[0]!.alreadySubscribed).toBe(false);
  });

  it("should cap how many videos one channel contributes in a single run", () => {
    // Eight results from one search are frequently the same creator; without a
    // cap a single query fills the shelf with one channel.
    const incoming = Array.from({ length: 8 }, (_u, i) =>
      chanVideo(`hogvideo${i}0`, "UChog"),
    );
    const { state } = mergeDiscovered(emptyState, incoming, new Set(), 1000);
    expect(state.entries.length).toBeLessThanOrEqual(PER_CHANNEL_RUN_CAP);
    expect(state.entries.length).toBeGreaterThan(0);
  });

  it("should not let one channel's cap block a different channel", () => {
    const incoming = [
      ...Array.from({ length: 8 }, (_u, i) => chanVideo(`hogvideo${i}0`, "UChog")),
      chanVideo("othervid001", "UCother"),
    ];
    const { state } = mergeDiscovered(emptyState, incoming, new Set(), 1000);
    expect(state.entries.some((e) => e.video.id === "othervid001")).toBe(true);
  });

  it("should not count channel-capped videos as seen, so they can surface later", () => {
    const incoming = Array.from({ length: 8 }, (_u, i) => chanVideo(`hogvideo${i}0`, "UChog"));
    const { state } = mergeDiscovered(emptyState, incoming, new Set(), 1000);
    expect(state.seenIds).toHaveLength(state.entries.length);
  });
});
