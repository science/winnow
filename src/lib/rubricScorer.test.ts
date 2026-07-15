import { describe, it, expect } from "vitest";
import type { ProfileTarget, VideoDigest } from "./types";
import { canonicalizeTarget, EMPTY_TARGET, isEmptyTarget, rankVideo, targetHash } from "./rubricScorer";

const DIGEST: VideoDigest = {
  summary: "Careful walkthrough of rook endgames.",
  topics: ["chess", "endgames"],
  format: "tutorial",
  emotionalTone: "calm",
  hypeSignals: [],
  substanceDensity: 5,
  clickbaitSeverity: 1,
  claimOverreach: 1,
  intellectualDemand: 4,
  productionEffort: 3,
  novelty: 3,
};

const target = (partial: Partial<ProfileTarget>): ProfileTarget => ({
  ...EMPTY_TARGET,
  ...partial,
});

describe("rankVideo", () => {
  it("should score 50 with no constraints (empty target ties everything)", () => {
    const r = rankVideo(DIGEST, EMPTY_TARGET);
    expect(r.score).toBe(50);
    expect(isEmptyTarget(EMPTY_TARGET)).toBe(true);
  });

  it("should score 100 on an exact numeric match and 50 at ordinal distance 2", () => {
    const exact = rankVideo(DIGEST, target({ fields: { substanceDensity: { target: 5, importance: 8 } } }));
    expect(exact.score).toBe(100);
    const dist2 = rankVideo(DIGEST, target({ fields: { novelty: { target: 5, importance: 8 } } }));
    expect(dist2.score).toBe(50); // |3-5|/4 => credit 0.5
  });

  it("should weight fields by importance and ignore importance-0 fields", () => {
    const r = rankVideo(
      DIGEST,
      target({
        fields: {
          substanceDensity: { target: 5, importance: 10 }, // credit 1
          novelty: { target: 5, importance: 10 }, // credit 0.5
          productionEffort: { target: 1, importance: 0 }, // ignored
        },
      }),
    );
    expect(r.score).toBe(75);
  });

  it("should credit topic matches case-insensitively and by substring", () => {
    const hit = rankVideo(DIGEST, target({ topicsMore: { items: ["Chess openings"], importance: 5 } }));
    expect(hit.score).toBe(100); // "chess" ⊂ "chess openings"
  });

  it("should treat a topicsMore miss as mildly negative, not catastrophic", () => {
    // A broad feed matches any topic list rarely; "not on your list" is weak
    // evidence, and must not be able to sink the whole feed below the
    // winnowed threshold on its own (the 2026-07 feed-collapse bug).
    const miss = rankVideo(DIGEST, target({ topicsMore: { items: ["woodworking"], importance: 5 } }));
    expect(miss.score).toBeGreaterThanOrEqual(30);
    expect(miss.score).toBeLessThan(50);
    expect(miss.reason).toContain("off your stated interests");
  });

  it("should zero the credit for avoided topics, formats, and tones", () => {
    expect(rankVideo(DIGEST, target({ topicsLess: { items: ["chess"], importance: 5 } })).score).toBe(0);
    expect(rankVideo(DIGEST, target({ formatsAvoid: { items: ["tutorial"], importance: 5 } })).score).toBe(0);
    expect(rankVideo(DIGEST, target({ tonesAvoid: { items: ["calm"], importance: 5 } })).score).toBe(0);
  });

  it("should treat NOT hitting an avoid-list as no evidence at all", () => {
    // Avoid-lists only subtract: lacking an avoided trait neither rewards
    // (v1 floated junk into Worth a look) nor dilutes real matches (an
    // early v2 draft capped on-profile videos below the Top threshold).
    expect(rankVideo(DIGEST, target({ topicsLess: { items: ["drama"], importance: 5 } })).score).toBe(50);
    const matchPlusMissedAvoid = rankVideo(
      DIGEST,
      target({
        fields: { substanceDensity: { target: 5, importance: 8 } },
        formatsAvoid: { items: ["reaction"], importance: 5 },
        tonesAvoid: { items: ["outraged"], importance: 5 },
      }),
    );
    expect(matchPlusMissedAvoid.score).toBe(100);
  });

  it("should flag clickbait from digest severity or claim overreach >= 4", () => {
    expect(rankVideo(DIGEST, EMPTY_TARGET).clickbait).toBe(false);
    expect(rankVideo({ ...DIGEST, clickbaitSeverity: 4 }, EMPTY_TARGET).clickbait).toBe(true);
    expect(rankVideo({ ...DIGEST, claimOverreach: 5 }, EMPTY_TARGET).clickbait).toBe(true);
  });

  it("should compose a deterministic reason under 120 chars naming top contributors", () => {
    const r = rankVideo(
      DIGEST,
      target({
        fields: { claimOverreach: { target: 1, importance: 10 } },
        topicsMore: { items: ["chess"], importance: 8 },
      }),
    );
    expect(r.reason.length).toBeLessThanOrEqual(120);
    expect(r.reason).toContain("claims stay grounded");
    expect(r.reason).toContain("chess");
    const bad = rankVideo({ ...DIGEST, claimOverreach: 5 }, target({ fields: { claimOverreach: { target: 1, importance: 10 } } }));
    expect(bad.reason).toContain("overclaims");
  });
});

describe("canonicalizeTarget", () => {
  it("should strip null field constraints and clamp ranges (strict-schema null workaround)", () => {
    const t = canonicalizeTarget({
      fields: {
        substanceDensity: { target: 9, importance: 15 },
        clickbaitSeverity: null,
        claimOverreach: { target: 1, importance: 10 },
        intellectualDemand: null,
        productionEffort: null,
        novelty: null,
      },
      topicsMore: { items: ["Chess", 42], importance: 5 },
      topicsLess: null,
      formatsAvoid: null,
      tonesAvoid: { items: ["Outraged"], importance: 20 },
    });
    expect(t.fields.substanceDensity).toEqual({ target: 5, importance: 10 });
    expect(t.fields.claimOverreach).toEqual({ target: 1, importance: 10 });
    expect(t.fields.clickbaitSeverity).toBeUndefined();
    expect(t.topicsMore).toEqual({ items: ["chess"], importance: 5 });
    expect(t.topicsLess).toEqual({ items: [], importance: 0 });
    expect(t.tonesAvoid).toEqual({ items: ["outraged"], importance: 10 });
  });

  it("should strip the catch-all 'other' format from formatsAvoid", () => {
    // clampDigest coerces every unrecognized format to "other", so letting
    // the translator avoid "other" penalizes arbitrary innocent videos.
    const t = canonicalizeTarget({
      fields: {},
      topicsMore: null,
      topicsLess: null,
      formatsAvoid: { items: ["reaction", "other", "highlights"], importance: 6 },
      tonesAvoid: null,
    });
    expect(t.formatsAvoid.items).toEqual(["reaction", "highlights"]);
    const onlyOther = canonicalizeTarget({
      fields: {},
      topicsMore: null,
      topicsLess: null,
      formatsAvoid: { items: ["other"], importance: 6 },
      tonesAvoid: null,
    });
    expect(onlyOther.formatsAvoid).toEqual({ items: [], importance: 0 });
  });

  it("should cap format/tone avoid-lists at 3 — beyond that the translator is hallucinating taste", () => {
    // Live nano run 2026-07-15 emitted formatsAvoid with 8 of 12 formats
    // (including "tutorial" for a profile asking for lessons), demoting
    // on-profile videos. Real people reject a couple of formats, not most.
    const t = canonicalizeTarget({
      fields: {},
      topicsMore: null,
      topicsLess: null,
      formatsAvoid: {
        items: ["news", "review", "interview", "reaction", "highlights", "vlog"],
        importance: 7,
      },
      tonesAvoid: null,
    });
    expect(t.formatsAvoid.items).toEqual(["news", "review", "interview"]);
  });

  it("should produce the empty target from a fully null translation", () => {
    const t = canonicalizeTarget({
      fields: {
        substanceDensity: null, clickbaitSeverity: null, claimOverreach: null,
        intellectualDemand: null, productionEffort: null, novelty: null,
      },
      topicsMore: null, topicsLess: null, formatsAvoid: null, tonesAvoid: null,
    });
    expect(isEmptyTarget(t)).toBe(true);
  });

  it("should survive garbage input as the empty target", () => {
    expect(isEmptyTarget(canonicalizeTarget(null))).toBe(true);
    expect(isEmptyTarget(canonicalizeTarget("junk"))).toBe(true);
  });
});

describe("targetHash", () => {
  it("should change when any constraint changes and be stable otherwise", () => {
    const a = target({ fields: { novelty: { target: 5, importance: 3 } } });
    const b = target({ fields: { novelty: { target: 4, importance: 3 } } });
    expect(targetHash(a)).toBe(targetHash(target({ fields: { novelty: { target: 5, importance: 3 } } })));
    expect(targetHash(a)).not.toBe(targetHash(b));
  });
});
