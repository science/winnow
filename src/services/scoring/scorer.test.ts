import { describe, it, expect, vi } from "vitest";
import { enrichWithTranscripts, runScoring } from "./scorer";
import { ProviderError, type RawScore, type ScoreBatchFn } from "./providerTypes";
import type { Profile, TranscriptCacheEntry, Video } from "../../lib/types";

const profile: Profile = { moreOf: "science", lessOf: "drama", updatedAt: 0 };

function video(id: string): Video {
  return {
    id,
    source: "subscriptions",
    title: `Video ${id}`,
    channelTitle: "c",
    channelId: null,
    durationText: "10:00",
    durationSec: 600,
    publishedText: "1 day ago",
    publishedAtApprox: Date.now(),
    viewCountText: "1K views",
    viewCount: 1000,
    thumbnailUrl: null,
    descriptionSnippet: null,
    isLive: false,
  };
}

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `vid${String(i).padStart(8, "0")}`);

function okAdapter(): ScoreBatchFn {
  return async (videos) =>
    videos.map((v): RawScore => ({ videoId: v.id, score: 80, reason: "good", clickbait: false }));
}

const noSleep = async (): Promise<void> => {};

describe("runScoring", () => {
  it("should score all cache-miss videos and report progress", async () => {
    const videos = ids(45).map(video);
    const onProgress = vi.fn();
    const result = await runScoring(videos, {
      adapter: okAdapter(),
      model: "test-model",
      apiKey: "k",
      profile,
      cache: {},
      sleep: noSleep,
      onProgress,
    });
    expect(Object.keys(result.scores)).toHaveLength(45);
    expect(result.unknownIds).toHaveLength(0);
    expect(result.fatalError).toBeNull();
    expect(onProgress).toHaveBeenLastCalledWith(45, 45);
  });

  it("should skip videos already in the cache (per-item cache hits)", async () => {
    const videos = ids(3).map(video);
    const adapter = vi.fn(okAdapter());
    const cached = { score: 10, reason: "cached", clickbait: false, scoredAt: 1, model: "test-model" };
    const result = await runScoring(videos, {
      adapter,
      model: "test-model",
      apiKey: "k",
      profile,
      cache: { [videos[0]!.id]: cached },
      sleep: noSleep,
    });
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(adapter.mock.calls[0]![0]).toHaveLength(2);
    expect(result.scores[videos[0]!.id]).toEqual(cached);
  });

  it("should clamp out-of-range scores and truncate long reasons", async () => {
    const videos = [video("clampme0000")];
    const adapter: ScoreBatchFn = async () => [
      { videoId: "clampme0000", score: 150, reason: "x".repeat(500), clickbait: false },
    ];
    const result = await runScoring(videos, {
      adapter, model: "m", apiKey: "k", profile, cache: {}, sleep: noSleep,
    });
    expect(result.scores["clampme0000"]!.score).toBe(100);
    expect(result.scores["clampme0000"]!.reason.length).toBeLessThanOrEqual(200);
  });

  it("should ignore hallucinated videoIds and mark unanswered ones unknown", async () => {
    const videos = [video("realid00000"), video("unanswered0")];
    const adapter: ScoreBatchFn = async () => [
      { videoId: "realid00000", score: 70, reason: "ok", clickbait: false },
      { videoId: "hallucinate", score: 99, reason: "??", clickbait: false },
    ];
    const result = await runScoring(videos, {
      adapter, model: "m", apiKey: "k", profile, cache: {}, sleep: noSleep,
    });
    expect(result.scores["hallucinate"]).toBeUndefined();
    expect(result.scores["realid00000"]).toBeDefined();
    expect(result.unknownIds).toEqual(["unanswered0"]);
  });

  it("should retry once on retryable errors, then succeed", async () => {
    const videos = ids(2).map(video);
    let calls = 0;
    const adapter: ScoreBatchFn = async (vs) => {
      calls++;
      if (calls === 1) throw new ProviderError("rate", "429");
      return vs.map((v) => ({ videoId: v.id, score: 60, reason: "r", clickbait: false }));
    };
    const sleep = vi.fn(noSleep);
    const result = await runScoring(videos, {
      adapter, model: "m", apiKey: "k", profile, cache: {}, sleep,
    });
    expect(calls).toBe(2);
    expect(sleep).toHaveBeenCalled();
    expect(Object.keys(result.scores)).toHaveLength(2);
  });

  it("should mark the batch unknown after retry exhaustion, without failing other batches", async () => {
    const videos = ids(25).map(video); // two batches of 20 + 5
    const adapter: ScoreBatchFn = async (vs) => {
      if (vs.length === 20) throw new ProviderError("server", "500");
      return vs.map((v) => ({ videoId: v.id, score: 55, reason: "r", clickbait: false }));
    };
    const result = await runScoring(videos, {
      adapter, model: "m", apiKey: "k", profile, cache: {}, sleep: noSleep,
    });
    expect(result.unknownIds).toHaveLength(20);
    expect(Object.keys(result.scores)).toHaveLength(5);
    expect(result.fatalError).toBeNull();
  });

  it("should fail fast (no retry) on bad_request per house retry policy", async () => {
    const videos = ids(1).map(video);
    const adapter = vi.fn(async (): Promise<RawScore[]> => {
      throw new ProviderError("bad_request", "400");
    });
    const result = await runScoring(videos, {
      adapter, model: "m", apiKey: "k", profile, cache: {}, sleep: noSleep,
    });
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(result.unknownIds).toHaveLength(1);
  });

  it("should abort remaining batches on auth errors and surface the fatal error", async () => {
    const videos = ids(60).map(video); // three batches
    const adapter = vi.fn(async (): Promise<RawScore[]> => {
      throw new ProviderError("auth", "401");
    });
    const result = await runScoring(videos, {
      adapter, model: "m", apiKey: "k", profile, cache: {}, sleep: noSleep,
    });
    expect(result.fatalError?.kind).toBe("auth");
    // With concurrency 2, at most the two in-flight batches were attempted.
    expect(adapter.mock.calls.length).toBeLessThanOrEqual(2);
    expect(result.unknownIds.length).toBe(60);
  });

  it("should call onBatch incrementally so the feed fills in live", async () => {
    const videos = ids(40).map(video);
    const onBatch = vi.fn();
    await runScoring(videos, {
      adapter: okAdapter(), model: "m", apiKey: "k", profile, cache: {}, sleep: noSleep, onBatch,
    });
    expect(onBatch).toHaveBeenCalledTimes(2);
  });
});

describe("enrichWithTranscripts", () => {
  const excerptOf = async (id: string) => ({ excerpt: `transcript of ${id}`, source: "timedtext" as const });
  const emptyCache = async (): Promise<Record<string, TranscriptCacheEntry>> => ({});
  const noSave = async (): Promise<void> => {};

  it("should cap transcript fetches per run at 60", async () => {
    const videos = ids(80).map(video);
    const fetchExcerpt = vi.fn(excerptOf);
    const result = await enrichWithTranscripts(videos, new Set(videos.map((v) => v.id)), {
      fetchExcerpt, loadCache: emptyCache, saveCache: noSave,
    });
    expect(fetchExcerpt).toHaveBeenCalledTimes(60);
    expect(result.attempted).toBe(60);
    expect(result.fetched).toBe(60);
  });

  it("should skip live videos", async () => {
    const live = { ...video("livenow0001"), isLive: true };
    const fetchExcerpt = vi.fn(excerptOf);
    const result = await enrichWithTranscripts([live, video("ordinary001")], new Set(["livenow0001", "ordinary001"]), {
      fetchExcerpt, loadCache: emptyCache, saveCache: noSave,
    });
    expect(fetchExcerpt).toHaveBeenCalledTimes(1);
    expect(fetchExcerpt).toHaveBeenCalledWith("ordinary001");
    expect(result.videos.find((v) => v.id === "livenow0001")!.transcriptExcerpt).toBeUndefined();
  });

  it("should use cached excerpts without fetching", async () => {
    const videos = [video("cachedvid01")];
    const fetchExcerpt = vi.fn(excerptOf);
    const cached: Record<string, TranscriptCacheEntry> = {
      cachedvid01: { excerpt: "from the cache", source: "innertube", fetchedAt: 1 },
    };
    const result = await enrichWithTranscripts(videos, new Set(["cachedvid01"]), {
      fetchExcerpt, loadCache: async () => cached, saveCache: noSave,
    });
    expect(fetchExcerpt).not.toHaveBeenCalled();
    expect(result.videos[0]!.transcriptExcerpt).toBe("from the cache");
    expect(result.fetched).toBe(1);
    expect(result.attempted).toBe(1);
  });

  it("should persist newly fetched excerpts to the transcript cache", async () => {
    const videos = [video("newfetch001")];
    const saveCache = vi.fn<(cache: Record<string, TranscriptCacheEntry>) => Promise<void>>(
      async () => {},
    );
    await enrichWithTranscripts(videos, new Set(["newfetch001"]), {
      fetchExcerpt: excerptOf, loadCache: emptyCache, saveCache,
    });
    expect(saveCache).toHaveBeenCalledTimes(1);
    const saved = saveCache.mock.calls[0]![0];
    expect(saved["newfetch001"]!.excerpt).toBe("transcript of newfetch001");
    expect(saved["newfetch001"]!.source).toBe("timedtext");
  });

  it("should report fetched/attempted coverage when some videos have no transcript", async () => {
    const videos = [video("hastrans001"), video("notrans0001")];
    const fetchExcerpt = async (id: string) =>
      id === "hastrans001" ? { excerpt: "found", source: "timedtext" as const } : null;
    const result = await enrichWithTranscripts(videos, new Set(["hastrans001", "notrans0001"]), {
      fetchExcerpt, loadCache: emptyCache, saveCache: noSave,
    });
    expect(result.fetched).toBe(1);
    expect(result.attempted).toBe(2);
  });

  it("should leave videos untouched when everything misses", async () => {
    const videos = [video("nothing0001")];
    const saveCache = vi.fn(noSave);
    const result = await enrichWithTranscripts(videos, new Set(["nothing0001"]), {
      fetchExcerpt: async () => null, loadCache: emptyCache, saveCache,
    });
    expect(result.videos[0]!.transcriptExcerpt).toBeUndefined();
    expect(result.fetched).toBe(0);
    expect(saveCache).not.toHaveBeenCalled();
  });
});
