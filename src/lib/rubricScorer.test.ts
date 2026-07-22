import { describe, it, expect } from "vitest";
import type { ProfileTarget, VideoDigest } from "./types";
import {
  canonicalizeTarget,
  EMPTY_TARGET,
  isEmptyTarget,
  rankVideo,
  TARGET_TOPICS_MAX,
  targetHash,
} from "./rubricScorer";
import gothamTargetRaw from "./fixtures/gotham-target.json";

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

  it("should match a broad profile item against a more specific digest topic", () => {
    const hit = rankVideo(
      { ...DIGEST, topics: ["chess openings"] },
      target({ topicsMore: { items: ["Chess"], importance: 5 } }),
    );
    expect(hit.score).toBe(100); // broad "chess" covers specific "chess openings"
  });

  it("should match profile items regardless of token order or plural form", () => {
    const hit = rankVideo(
      { ...DIGEST, topics: ["chess engines"] },
      target({ topicsMore: { items: ["engine chess"], importance: 5 } }),
    );
    expect(hit.score).toBe(100);
  });

  it("should not match a qualified avoid item against its bare parent topic", () => {
    // "Low tier comic chess games" in the avoid list must not fire on every
    // chess video — the 2026-07 gotham bug: bidirectional substring matching
    // reduced "comic chess" to "chess" and contradicted the seek list.
    const r = rankVideo(DIGEST, target({ topicsLess: { items: ["comic chess"], importance: 8 } }));
    expect(r.score).toBe(50); // no avoid contribution — no evidence either way
  });

  it("should not match a qualified seek item against its bare parent topic", () => {
    const r = rankVideo(DIGEST, target({ topicsMore: { items: ["top tier chess"], importance: 5 } }));
    expect(r.score).toBeLessThan(50); // qualified interest ⊅ generic chess video
  });

  it("should name the profile item, not the digest topic, in avoid reasons", () => {
    const r = rankVideo(
      { ...DIGEST, topics: ["gothamchess comic chess recap"] },
      target({ topicsLess: { items: ["comic chess"], importance: 8 } }),
    );
    expect(r.reason).toContain("avoided: comic chess");
    expect(r.reason).not.toContain("recap");
  });

  it("should cap a video below Worth-a-look when an avoided topic genuinely matches", () => {
    // Averaging alone let avoid hits drown in quality-axis credit (the
    // gotham bug rode "clean packaging" into the top tier).
    const r = rankVideo(
      { ...DIGEST, topics: ["chess", "comic chess"] },
      target({
        fields: {
          substanceDensity: { target: 5, importance: 9 },
          clickbaitSeverity: { target: 1, importance: 8 },
        },
        topicsMore: { items: ["chess"], importance: 9 },
        topicsLess: { items: ["comic chess"], importance: 8 },
      }),
    );
    expect(r.score).toBeLessThanOrEqual(45);
    expect(r.reason.startsWith("avoided: comic chess")).toBe(true);
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

  it("should winnow low-tier comic chess and top-rank elite play for the captured gotham target", () => {
    // The real translated target behind the 2026-07 mis-ranking (fixture
    // extracted from the debug capture): "chess" sought broadly, "comic
    // chess" avoided. The comic video must land behind the fold; elite
    // play must stay on top.
    const gotham = canonicalizeTarget(gothamTargetRaw);
    const comic = rankVideo(
      {
        summary: "Comedic recap of a low-rated players' blunder-filled game.",
        topics: ["chess", "comic chess", "blunders"],
        format: "entertainment",
        emotionalTone: "humorous",
        hypeSignals: [],
        substanceDensity: 3,
        clickbaitSeverity: 2,
        claimOverreach: 1,
        intellectualDemand: 2,
        productionEffort: 3,
        novelty: 2,
      },
      gotham,
    );
    expect(comic.score).toBeLessThan(50);
    const elite = rankVideo(
      {
        summary: "Deep analysis of a world-championship game.",
        topics: ["chess", "top tier play", "chess engine"],
        format: "explainer",
        emotionalTone: "calm",
        hypeSignals: [],
        substanceDensity: 5,
        clickbaitSeverity: 1,
        claimOverreach: 1,
        intellectualDemand: 4,
        productionEffort: 4,
        novelty: 3,
      },
      gotham,
    );
    expect(elite.score).toBeGreaterThanOrEqual(75);
  });

  it("should winnow a celebrity-crossover exhibition tagged casual while elite play stays on top", () => {
    // The 2026-07-21 Tyler1/Faker mis-ranking: famous non-chess players in a
    // casual exhibition. Once the enricher tiers it correctly (casual, not
    // elite) and the translator's avoid list spans the whole rejected
    // register (comedic/amateur/casual), the avoid cap must put it behind
    // the fold — while genuinely elite content stays unaffected.
    const t = target({
      fields: {
        substanceDensity: { target: 5, importance: 9 },
        clickbaitSeverity: { target: 1, importance: 8 },
      },
      topicsMore: { items: ["elite chess"], importance: 9 },
      topicsLess: { items: ["comedic chess", "amateur chess", "casual chess"], importance: 8 },
    });
    const crossover = rankVideo(
      {
        summary: "Two famous streamers play a casual banter-filled chess match.",
        topics: ["casual chess", "comedic chess", "chess"],
        format: "entertainment",
        emotionalTone: "humorous",
        hypeSignals: [],
        substanceDensity: 2,
        clickbaitSeverity: 2,
        claimOverreach: 1,
        intellectualDemand: 1,
        productionEffort: 3,
        novelty: 2,
      },
      t,
    );
    expect(crossover.score).toBeLessThanOrEqual(45);
    expect(crossover.reason.startsWith("avoided:")).toBe(true);
    const elite = rankVideo(
      {
        summary: "Deep analysis of a super-tournament game.",
        topics: ["elite chess", "chess", "endgames"],
        format: "explainer",
        emotionalTone: "calm",
        hypeSignals: [],
        substanceDensity: 5,
        clickbaitSeverity: 1,
        claimOverreach: 1,
        intellectualDemand: 4,
        productionEffort: 4,
        novelty: 3,
      },
      t,
    );
    expect(elite.score).toBeGreaterThanOrEqual(75);
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

  it("should drop list items whose tokens strictly contain another item's tokens", () => {
    // Translator synonym spam ("engineering" ×5 variants) adds no matching
    // power under token-subset matching: if Y's tokens ⊆ X's tokens, every
    // topic X matches, Y already matches.
    const t = canonicalizeTarget({
      fields: {},
      topicsMore: {
        items: ["engineering", "engineering applications", "engineering practice"],
        importance: 9,
      },
      topicsLess: { items: ["comic chess", "low tier comic chess"], importance: 8 },
      formatsAvoid: null,
      tonesAvoid: null,
    });
    expect(t.topicsMore.items).toEqual(["engineering"]);
    // "low tier comic chess" collapses into "comic chess" (superset drop
    // after the "low tier"→amateur rewrite); the ambiguous "comic" also
    // expands a "comedic" variant so the canonical tier word can match.
    expect(t.topicsLess.items).toEqual(["comic chess", "comedic chess"]);
  });

  it("should map free-form tier qualifiers onto the digest vocabulary", () => {
    // The enricher's subjectTiers are schema-forced onto the canonical list,
    // so a translator tag with any other qualifier token-matches nothing.
    const t = canonicalizeTarget({
      fields: {},
      topicsMore: { items: ["top tier chess", "pro engineering"], importance: 8 },
      topicsLess: { items: ["low tier chess", "novice woodworking"], importance: 7 },
      formatsAvoid: null,
      tonesAvoid: null,
    });
    expect(t.topicsMore.items).toEqual(["elite chess", "professional engineering"]);
    expect(t.topicsLess.items).toEqual(["amateur chess", "beginner woodworking"]);
  });

  it("should expand a leading 'comic' into a comedic variant while keeping the original", () => {
    // "comic" is ambiguous: a tier qualifier in "comic chess" (live nano
    // emitted the user's literal word, which never matches the enricher's
    // schema-forced "comedic" tag) but a subject in "comic books". A blanket
    // rewrite would corrupt comic-book interests, so expand instead —
    // whichever reading is right matches, the other stays inert.
    const t = canonicalizeTarget({
      topicsMore: { items: ["comic books"], importance: 5 },
      topicsLess: { items: ["comic chess"], importance: 8 },
    });
    expect(t.topicsLess.items).toContain("comic chess");
    expect(t.topicsLess.items).toContain("comedic chess");
    expect(t.topicsMore.items).toContain("comic books");
    expect(t.topicsMore.items).toContain("comedic books"); // inert, harmless
  });

  it("should strip quality adjectives from topicsMore so the bare subject can match", () => {
    // Live 2026-07-19: "practical, professional or serious" engineering became
    // three tags, two of which ("practical/serious engineering") the enricher
    // never emits — inert slots. Quality lives in the numeric axes; the tag's
    // job is naming the subject.
    const t = canonicalizeTarget({
      fields: {},
      topicsMore: {
        items: ["practical engineering", "serious engineering", "good quality movie previews"],
        importance: 8,
      },
      topicsLess: null,
      formatsAvoid: null,
      tonesAvoid: null,
    });
    expect(t.topicsMore.items).toEqual(["engineering", "movie previews"]);
  });

  it("should not strip quality adjectives from topicsLess", () => {
    // Broadening an avoid item over-penalizes ("practical engineering" →
    // "engineering" would veto content the person wants — the gotham shape);
    // an inert avoid tag is the safe failure.
    const t = canonicalizeTarget({
      fields: {},
      topicsMore: null,
      topicsLess: { items: ["practical engineering"], importance: 6 },
      formatsAvoid: null,
      tonesAvoid: null,
    });
    expect(t.topicsLess.items).toEqual(["practical engineering"]);
  });

  it("should leave compound subjects untouched", () => {
    // "computer science", "cultural anthropology" are subjects, not
    // qualifier+subject — only known tier synonyms may be rewritten.
    const t = canonicalizeTarget({
      fields: {},
      topicsMore: { items: ["computer science", "cultural anthropology", "film studies"], importance: 8 },
      topicsLess: { items: ["video games"], importance: 8 },
      formatsAvoid: null,
      tonesAvoid: null,
    });
    expect(t.topicsMore.items).toEqual(["computer science", "cultural anthropology", "film studies"]);
    expect(t.topicsLess.items).toEqual(["video games"]);
  });

  it("should drop quality-complaint pseudo-topics from both topic lists", () => {
    // Live 2026-07-19: "science provocateurs" landed in topicsLess despite the
    // prompt. Complaints rank via the axes (claimOverreach/clickbaitSeverity);
    // as topics they match nothing and muddy the audit display.
    const t = canonicalizeTarget({
      fields: {},
      topicsMore: null,
      topicsLess: {
        items: ["science provocateurs", "clickbait", "overhyped movies", "drama narratives"],
        importance: 9,
      },
      formatsAvoid: null,
      tonesAvoid: null,
    });
    expect(t.topicsLess.items).toEqual(["drama narratives"]);
  });

  it("should keep up to TARGET_TOPICS_MAX topics per list", () => {
    const items = Array.from({ length: TARGET_TOPICS_MAX + 3 }, (_, i) => `subject${i}`);
    const t = canonicalizeTarget({
      fields: {},
      topicsMore: { items, importance: 8 },
      topicsLess: null,
      formatsAvoid: null,
      tonesAvoid: null,
    });
    expect(t.topicsMore.items).toHaveLength(TARGET_TOPICS_MAX);
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
