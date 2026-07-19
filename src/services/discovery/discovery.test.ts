// Integration tests for the go-deeper orchestrator: real stores/storage
// (in-memory fallback), stubbed search fetch + query generation + scoring.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import type { Video } from "../../lib/types";

beforeEach(() => {
  vi.resetModules();
});

function searchHtmlFor(ids: string[]): string {
  const items = ids.map((id) => ({
    videoRenderer: {
      videoId: id,
      title: { simpleText: `Result ${id}` },
      ownerText: { runs: [{ text: "Some Channel" }] },
      lengthText: { simpleText: "10:00" },
    },
  }));
  const data = {
    contents: {
      sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: items } }] },
    },
  };
  return `<html><script>ytcfg.set({"LOGGED_IN":true});</script><script>var ytInitialData = ${JSON.stringify(data)};</script></html>`;
}

async function boot(opts: {
  resultsByQuery: Record<string, string[] | Error>;
  poolQueries: string[];
  feedVideoIds?: string[];
}) {
  const storage = await import("../../lib/storage");
  const settingsStore = await import("../../stores/settingsStore");
  await settingsStore.settingsReady;
  settingsStore.settings.set({
    ...settingsStore.DEFAULT_SETTINGS,
    anthropicApiKey: "sk-test",
  });
  settingsStore.profile.update((p) => ({ ...p, moreOf: "woodworking", updatedAt: 1 }));

  const profilesStore = await import("../../stores/profilesStore");
  const profileId = get(profilesStore.profilesState).activeProfileId;

  // Seed the query pool directly so generation is a cache hit.
  const { queryPoolInputHashFor } = await import("../scoring/discoverQueries");
  await storage.storageSet(storage.profileKeys(profileId).discoverQueries, {
    inputHash: queryPoolInputHashFor(
      get(settingsStore.profile),
      "claude-haiku-4-5",
    ),
    queries: opts.poolQueries.map((text) => ({ text, lastUsedAt: 0 })),
  });

  const feedStore = await import("../../stores/feedStore");
  if (opts.feedVideoIds) {
    feedStore.videos.set(
      opts.feedVideoIds.map(
        (id): Video => ({
          id,
          source: "subscriptions",
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
        }),
      ),
    );
  }

  const fetchCalls: string[] = [];
  const fetchSearchPageFn = vi.fn(async (query: string) => {
    fetchCalls.push(query);
    const result = opts.resultsByQuery[query];
    if (result === undefined) throw new Error(`unexpected query: ${query}`);
    if (result instanceof Error) throw result;
    const { extractYtInitialData } = await import("../youtube/ytPage");
    return {
      data: extractYtInitialData(searchHtmlFor(result)),
      loggedIn: true,
      rawJson: "",
    };
  });
  const scoreFeedFn = vi.fn(async () => {});

  const discoveryStore = await import("../../stores/discoveryStore");
  await discoveryStore.discoveryReady;
  const svc = await import("./discovery");
  const deps = { fetchSearchPageFn, scoreFeedFn, sleep: async () => {}, now: () => 1000 };
  return { storage, discoveryStore, svc, deps, fetchCalls, scoreFeedFn, profileId, profilesStore };
}

describe("runDiscovery", () => {
  it("should fetch each picked query sequentially, merge parsed results, persist, and trigger scoring", async () => {
    const { discoveryStore, svc, deps, fetchCalls, scoreFeedFn, storage, profileId } = await boot({
      poolQueries: ["query one", "query two"],
      resultsByQuery: {
        "query one": ["resultvid001", "resultvid002"],
        "query two": ["resultvid003"],
      },
    });

    await svc.runDiscoveryOnce(deps);

    expect(fetchCalls).toEqual(["query one", "query two"]);
    const entries = get(discoveryStore.discovered);
    expect(entries.map((e) => e.video.id)).toEqual([
      "resultvid001",
      "resultvid002",
      "resultvid003",
    ]);
    expect(entries[0]!.video.source).toBe("search");
    expect(entries[0]!.query).toBe("query one");
    expect(scoreFeedFn).toHaveBeenCalled();

    const stored = await storage.storageGet<{ entries: unknown[]; seenIds: string[] }>(
      storage.profileKeys(profileId).discovered,
    );
    expect(stored?.entries).toHaveLength(3);
    expect(stored?.seenIds).toEqual(["resultvid001", "resultvid002", "resultvid003"]);

    // Used queries got their lastUsedAt stamped.
    const pool = await storage.storageGet<{ queries: { text: string; lastUsedAt: number }[] }>(
      storage.profileKeys(profileId).discoverQueries,
    );
    expect(pool?.queries.every((q) => q.lastUsedAt === 1000)).toBe(true);
  });

  it("should degrade a failed query to a warning, continue, and leave it unstamped for retry", async () => {
    const { discoveryStore, svc, deps, storage, profileId } = await boot({
      poolQueries: ["will fail", "will work"],
      resultsByQuery: {
        "will fail": new Error("HTTP 429"),
        "will work": ["survivor0001"],
      },
    });

    await svc.runDiscoveryOnce(deps);

    expect(get(discoveryStore.discovered).map((e) => e.video.id)).toEqual(["survivor0001"]);
    const status = get(discoveryStore.discoveryStatus);
    expect(status.phase).toBe("idle");
    expect(status.warnings.join(" ")).toMatch(/will fail/);

    const pool = await storage.storageGet<{ queries: { text: string; lastUsedAt: number }[] }>(
      storage.profileKeys(profileId).discoverQueries,
    );
    expect(pool?.queries.find((q) => q.text === "will fail")?.lastUsedAt).toBe(0);
    expect(pool?.queries.find((q) => q.text === "will work")?.lastUsedAt).toBe(1000);
  });

  it("should surface an error when every query fails", async () => {
    const { discoveryStore, svc, deps } = await boot({
      poolQueries: ["dead one", "dead two"],
      resultsByQuery: {
        "dead one": new Error("HTTP 500"),
        "dead two": new Error("network down"),
      },
    });

    await svc.runDiscoveryOnce(deps);

    expect(get(discoveryStore.discoveryStatus).phase).toBe("error");
    expect(get(discoveryStore.discovered)).toEqual([]);
  });

  it("should never re-surface feed videos or previously seen discoveries", async () => {
    const { discoveryStore, svc, deps } = await boot({
      poolQueries: ["query one", "query two"],
      feedVideoIds: ["infeedvideo1"],
      resultsByQuery: {
        "query one": ["infeedvideo1", "fresh0000001"],
        "query two": ["fresh0000001", "fresh0000002"],
      },
    });

    await svc.runDiscoveryOnce(deps);

    expect(get(discoveryStore.discovered).map((e) => e.video.id)).toEqual([
      "fresh0000001",
      "fresh0000002",
    ]);
  });

  it("should rotate to unused queries on the second run and report exhaustion when nothing new turns up", async () => {
    const { discoveryStore, svc, deps, fetchCalls } = await boot({
      // QUERIES_PER_RUN is 5: seed 6 queries so run 1 leaves one unused.
      poolQueries: ["q1", "q2", "q3", "q4", "q5", "q6"],
      resultsByQuery: {
        q1: ["vid000000001"],
        q2: [],
        q3: [],
        q4: [],
        q5: [],
        q6: ["vid000000001"], // already seen by run 1 → nothing new
      },
    });

    await svc.runDiscoveryOnce(deps);
    expect(fetchCalls).toEqual(["q1", "q2", "q3", "q4", "q5"]);
    expect(get(discoveryStore.discovered)).toHaveLength(1);

    await svc.runDiscoveryOnce(deps);
    // Second run leads with the never-used q6.
    expect(fetchCalls.slice(5, 6)).toEqual(["q6"]);
    expect(get(discoveryStore.discovered)).toHaveLength(1);
    const status = get(discoveryStore.discoveryStatus);
    expect(status.phase).toBe("idle");
    expect(status.detail).toMatch(/regenerate/i);
  });
});
