import { describe, expect, it } from "vitest";
import { buildScoringDebug } from "./scoringDebug";
import type { EnrichmentEntry, VideoScore } from "./types";

const digest = (over: Partial<EnrichmentEntry["digest"]> = {}): EnrichmentEntry["digest"] => ({
  summary: "s",
  topics: ["chess"],
  format: "tutorial",
  emotionalTone: "calm",
  hypeSignals: [],
  substanceDensity: 3,
  clickbaitSeverity: 2,
  claimOverreach: 2,
  intellectualDemand: 3,
  productionEffort: 3,
  novelty: 3,
  ...over,
});

const entry = (hadTranscript: boolean, over: Partial<EnrichmentEntry["digest"]> = {}): EnrichmentEntry => ({
  digest: digest(over),
  contentHash: "h",
  model: "m",
  promptVersion: 1,
  hadTranscript,
  enrichedAt: 0,
});

const score = (n: number): VideoScore => ({
  score: n,
  reason: "r",
  clickbait: false,
  scoredAt: 0,
  model: "two-phase(m)",
});

describe("buildScoringDebug", () => {
  it("should summarize scores as a histogram with tier counts", () => {
    const debug = buildScoringDebug({
      target: null,
      scores: { a: score(80), b: score(55), c: score(42), d: score(48) },
      enrichment: null,
    });
    expect(debug.scores).toEqual({
      count: 4,
      tiers: { top: 1, worthALook: 1, winnowed: 2 },
      histogram: { "40s": 2, "50s": 1, "80s": 1 },
    });
  });

  it("should summarize enrichment coverage and per-axis means, not full digests", () => {
    const debug = buildScoringDebug({
      target: null,
      scores: null,
      enrichment: {
        a: entry(true, { claimOverreach: 5 }),
        b: entry(false, { claimOverreach: 1 }),
      },
    });
    expect(debug.enrichment.count).toBe(2);
    expect(debug.enrichment.withTranscript).toBe(1);
    expect(debug.enrichment.axisMeans.claimOverreach).toBe(3);
    expect(debug.enrichment.formats).toEqual({ tutorial: 2 });
    expect(JSON.stringify(debug)).not.toContain('"summary"');
  });

  it("should pass the stored target through verbatim and survive empty storage", () => {
    const target = { fields: {}, topicsMore: { items: ["chess"], importance: 5 } };
    const debug = buildScoringDebug({ target, scores: null, enrichment: null });
    expect(debug.target).toBe(target);
    expect(debug.scores.count).toBe(0);
    expect(debug.enrichment.count).toBe(0);
  });
});
