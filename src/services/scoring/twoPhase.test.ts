// Integration tests for the two-phase pipeline: real internals (clamping,
// ranking, cache validity, hashing), stubbed provider + transcript fetch.
import { describe, it, expect, vi } from "vitest";
import type { EnrichmentEntry, Profile, Video } from "../../lib/types";
import { ProviderError } from "./providerTypes";
import { ENRICHMENT_PROMPT_VERSION, ENRICH_TRANSCRIPT_CHARS } from "./enrichPrompt";
import {
  contentHashFor,
  enrichBatch,
  runTwoPhaseScoring,
  type StoredTarget,
  type StructuredCallFn,
  type TwoPhaseDeps,
} from "./twoPhase";

const video = (id: string, extra: Partial<Video> = {}): Video => ({
  id,
  source: "home",
  title: `Video ${id}`,
  channelTitle: "Chan",
  channelId: null,
  durationText: "10:00",
  durationSec: 600,
  publishedText: "1 day ago",
  publishedAtApprox: null,
  viewCountText: "1K views",
  viewCount: 1000,
  thumbnailUrl: null,
  descriptionSnippet: null,
  isLive: false,
  ...extra,
});

const profile: Profile = { moreOf: "deep chess analysis", lessOf: "hype", updatedAt: 0 };

const digestFor = (videoId: string, overrides: Record<string, unknown> = {}) => ({
  videoId,
  summary: `What ${videoId} actually covers.`,
  topics: ["chess"],
  format: "tutorial",
  emotionalTone: "calm",
  hypeSignals: [],
  substanceDensity: 5,
  clickbaitSeverity: 1,
  claimOverreach: 1,
  intellectualDemand: 4,
  productionEffort: 3,
  novelty: 3,
  ...overrides,
});

const TRANSLATION = {
  fields: {
    substanceDensity: { target: 5, importance: 8 },
    clickbaitSeverity: null,
    claimOverreach: { target: 1, importance: 9 },
    intellectualDemand: null,
    productionEffort: null,
    novelty: null,
  },
  topicsMore: { items: ["chess"], importance: 7 },
  topicsLess: null,
  formatsAvoid: null,
  tonesAvoid: null,
};

/** Provider stub: answers translate_profile with TRANSLATION and
 * digest_videos with clean digests for every requested id. */
function stubCall(opts: { digestOverrides?: Record<string, Record<string, unknown>> } = {}) {
  const calls: Array<{ name: string; user: string }> = [];
  const callFn = (async (spec: { name: string; user: string }) => {
    calls.push({ name: spec.name, user: spec.user });
    if (spec.name === "translate_profile") return TRANSLATION;
    const items = JSON.parse(spec.user.replace(/<\/?videos>/g, "")) as Array<{ videoId: string }>;
    return {
      digests: items.map((i) => digestFor(i.videoId, opts.digestOverrides?.[i.videoId])),
    };
  }) as StructuredCallFn;
  return { callFn, calls };
}

function memoryDeps(callFn: StructuredCallFn, extra: Partial<TwoPhaseDeps> = {}): TwoPhaseDeps & {
  enrichmentCache: Record<string, EnrichmentEntry>;
} {
  const state: {
    enrichment: Record<string, EnrichmentEntry> | null;
    target: StoredTarget | null;
  } = {
    enrichment: null,
    target: null,
  };
  const deps = {
    provider: "openai" as const,
    apiKey: "k",
    model: "stub-nano",
    profile,
    callFn,
    fetchExcerpt: async () => ({ excerpt: "full transcript words", source: "player" as const }),
    loadEnrichment: async () => state.enrichment,
    saveEnrichment: async (c: Record<string, EnrichmentEntry>) => {
      state.enrichment = c;
    },
    loadTarget: async () => state.target,
    saveTarget: async (t: StoredTarget) => {
      state.target = t;
    },
    sleep: async () => {},
    ...extra,
  };
  return Object.defineProperty(deps, "enrichmentCache", {
    get: () => state.enrichment ?? {},
  }) as typeof deps & { enrichmentCache: Record<string, EnrichmentEntry> };
}

describe("enrichBatch", () => {
  it("should drop hallucinated ids and unclampable digests", async () => {
    const callFn = (async () => ({
      digests: [
        digestFor("realvideo01"),
        digestFor("hallucinatd"),
        digestFor("realvideo02", { substanceDensity: "high" }),
      ],
    })) as StructuredCallFn;
    const out = await enrichBatch(
      [
        { video: video("realvideo01"), transcript: null },
        { video: video("realvideo02"), transcript: null },
      ],
      "openai",
      "k",
      "m",
      callFn,
    );
    expect([...out.keys()]).toEqual(["realvideo01"]);
  });
});

describe("runTwoPhaseScoring", () => {
  it("should enrich, translate, and rank end-to-end with fresh caches", async () => {
    const { callFn, calls } = stubCall();
    const deps = memoryDeps(callFn);
    const result = await runTwoPhaseScoring([video("aaaaaaaaaa1"), video("aaaaaaaaaa2")], deps);

    expect(result.fatalError).toBeNull();
    expect(result.unknownIds).toEqual([]);
    expect(result.enriched).toBe(2);
    // Perfect digest against the stub target: exact substance, grounded
    // claims, topic hit.
    expect(result.scores["aaaaaaaaaa1"]!.score).toBe(100);
    expect(result.scores["aaaaaaaaaa1"]!.model).toBe("two-phase(stub-nano)");
    expect(result.scores["aaaaaaaaaa1"]!.reason.length).toBeGreaterThan(0);
    expect(calls.filter((c) => c.name === "translate_profile")).toHaveLength(1);
    expect(result.scoresHash).not.toBe("");
  });

  it("should rank a BS video low and flag it via claim overreach", async () => {
    const { callFn } = stubCall({
      digestOverrides: {
        provocateur: { claimOverreach: 5, clickbaitSeverity: 4, topics: ["physics"] },
      },
    });
    const result = await runTwoPhaseScoring([video("provocateur")], memoryDeps(callFn));
    const s = result.scores["provocateur"]!;
    expect(s.score).toBeLessThan(40);
    expect(s.clickbait).toBe(true);
    expect(s.reason).toContain("overclaims");
  });

  it("should make a second run fully cache-served: no LLM calls, same scores", async () => {
    const { callFn, calls } = stubCall();
    const deps = memoryDeps(callFn);
    const first = await runTwoPhaseScoring([video("cachedvid01")], deps);
    const callsAfterFirst = calls.length;
    const second = await runTwoPhaseScoring([video("cachedvid01")], deps);
    expect(calls.length).toBe(callsAfterFirst); // translation + enrichment both cached
    expect(second.enriched).toBe(0);
    expect(second.scores["cachedvid01"]!.score).toBe(first.scores["cachedvid01"]!.score);
  });

  it("should keep a metadata-only digest provisional: reuse while unchanged, re-enrich when a transcript appears", async () => {
    const { callFn, calls } = stubCall();
    let transcriptAvailable = false;
    const deps = memoryDeps(callFn, {
      fetchExcerpt: async () =>
        transcriptAvailable
          ? { excerpt: "the actual talk", source: "player" as const }
          : { failure: "no-tracks" },
    });

    await runTwoPhaseScoring([video("notrackvid1")], deps);
    expect(deps.enrichmentCache["notrackvid1"]!.hadTranscript).toBe(false);
    const enrichCallsAfterFirst = calls.filter((c) => c.name === "digest_videos").length;

    // Unchanged input: transcript still missing → no new LLM spend.
    await runTwoPhaseScoring([video("notrackvid1")], deps);
    expect(calls.filter((c) => c.name === "digest_videos").length).toBe(enrichCallsAfterFirst);

    // Transcript appears → content hash changes → re-enriched with it.
    transcriptAvailable = true;
    const third = await runTwoPhaseScoring([video("notrackvid1")], deps);
    expect(third.enriched).toBe(1);
    expect(deps.enrichmentCache["notrackvid1"]!.hadTranscript).toBe(true);
  });

  it("should invalidate cached digests when the model or prompt version changes", async () => {
    const { callFn } = stubCall();
    const deps = memoryDeps(callFn);
    await runTwoPhaseScoring([video("modelswap01")], deps);
    const entry = deps.enrichmentCache["modelswap01"]!;
    expect(entry.model).toBe("stub-nano");
    expect(entry.promptVersion).toBe(ENRICHMENT_PROMPT_VERSION);

    const swapped = await runTwoPhaseScoring([video("modelswap01")], { ...deps, model: "other-model" });
    expect(swapped.enriched).toBe(1);
  });

  it("should skip transcript fetches for live videos but still digest them from metadata", async () => {
    const { callFn } = stubCall();
    const fetchExcerpt = vi.fn(async () => ({ excerpt: "words", source: "player" as const }));
    const deps = memoryDeps(callFn, { fetchExcerpt });
    const result = await runTwoPhaseScoring([video("livestream1", { isLive: true })], deps);
    expect(fetchExcerpt).not.toHaveBeenCalled();
    expect(result.scores["livestream1"]).toBeDefined();
    expect(result.transcripts.attempted).toBe(0);
  });

  it("should respect the per-run transcript cap", async () => {
    const { callFn } = stubCall();
    const fetchExcerpt = vi.fn(async () => ({ excerpt: "words", source: "player" as const }));
    const videos = Array.from({ length: 5 }, (_, i) => video(`capvideo00${i}`));
    await runTwoPhaseScoring(videos, memoryDeps(callFn, { fetchExcerpt, transcriptCap: 2 }));
    expect(fetchExcerpt).toHaveBeenCalledTimes(2);
  });

  it("should pass the enrichment transcript budget to the fetcher and persist the direct-mode excerpt slice", async () => {
    const { callFn } = stubCall();
    const saveExcerpt = vi.fn(async () => {});
    const fetchExcerpt = vi.fn(async () => ({ excerpt: "y".repeat(5000), source: "player" as const }));
    await runTwoPhaseScoring([video("budgetvid01")], memoryDeps(callFn, { fetchExcerpt, saveExcerpt }));
    expect(fetchExcerpt).toHaveBeenCalledWith("budgetvid01", ENRICH_TRANSCRIPT_CHARS);
    expect(saveExcerpt).toHaveBeenCalledWith("budgetvid01", "y".repeat(2000));
  });

  it("should abort on an auth error from translation and mark everything unknown", async () => {
    const callFn = (async () => {
      throw new ProviderError("auth", "bad key");
    }) as StructuredCallFn;
    const result = await runTwoPhaseScoring([video("authfail001")], memoryDeps(callFn));
    expect(result.fatalError?.kind).toBe("auth");
    expect(result.unknownIds).toEqual(["authfail001"]);
  });

  it("should leave failed enrichment batches unknown without failing the run", async () => {
    const callFn = (async (spec: { name: string }) => {
      if (spec.name === "translate_profile") return TRANSLATION;
      throw new ProviderError("bad_response", "malformed");
    }) as StructuredCallFn;
    const result = await runTwoPhaseScoring([video("badbatch001")], memoryDeps(callFn));
    expect(result.fatalError).toBeNull();
    expect(result.unknownIds).toEqual(["badbatch001"]);
    expect(result.scores).toEqual({});
  });

  it("should retry a retryable enrichment failure once", async () => {
    let enrichAttempts = 0;
    const callFn = (async (spec: { name: string; user: string }) => {
      if (spec.name === "translate_profile") return TRANSLATION;
      enrichAttempts++;
      if (enrichAttempts === 1) throw new ProviderError("rate", "429");
      const items = JSON.parse(spec.user.replace(/<\/?videos>/g, "")) as Array<{ videoId: string }>;
      return { digests: items.map((i) => digestFor(i.videoId)) };
    }) as StructuredCallFn;
    const result = await runTwoPhaseScoring([video("retryvideo1")], memoryDeps(callFn));
    expect(enrichAttempts).toBe(2);
    expect(result.scores["retryvideo1"]).toBeDefined();
  });

  it("should change the scores hash when the profile translation changes", async () => {
    const { callFn } = stubCall();
    const deps = memoryDeps(callFn);
    const a = await runTwoPhaseScoring([video("hashvideo01")], deps);
    const differentTranslation = {
      ...TRANSLATION,
      topicsMore: { items: ["woodworking"], importance: 9 },
    };
    const callFn2 = (async (spec: { name: string; user: string }) => {
      if (spec.name === "translate_profile") return differentTranslation;
      const items = JSON.parse(spec.user.replace(/<\/?videos>/g, "")) as Array<{ videoId: string }>;
      return { digests: items.map((i) => digestFor(i.videoId)) };
    }) as StructuredCallFn;
    const b = await runTwoPhaseScoring([video("hashvideo01")], {
      ...memoryDeps(callFn2),
      profile: { ...profile, moreOf: "woodworking", updatedAt: 1 },
    });
    expect(a.scoresHash).not.toBe(b.scoresHash);
  });
});

describe("contentHashFor", () => {
  it("should change when the transcript appears and be stable otherwise", () => {
    const v = video("hashstable1");
    expect(contentHashFor(v, null)).toBe(contentHashFor(v, null));
    expect(contentHashFor(v, "words")).not.toBe(contentHashFor(v, null));
  });
});
