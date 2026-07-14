import { describe, it, expect, vi } from "vitest";
import { runScoring } from "./scorer";
import { ProviderError, type RawScore, type ScoreBatchFn } from "./providerTypes";
import type { Profile, Video } from "../../lib/types";

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
