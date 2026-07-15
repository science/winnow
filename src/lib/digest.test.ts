import { describe, it, expect } from "vitest";
import { clampDigest, DIGEST_FORMATS, DIGEST_TONES } from "./digest";

const RAW_OK = {
  summary: "Explains rook endgames with worked examples.",
  topics: ["Chess", "endgames"],
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

describe("clampDigest", () => {
  it("should pass a well-formed digest through with topics lowercased", () => {
    const d = clampDigest(RAW_OK)!;
    expect(d.topics).toEqual(["chess", "endgames"]);
    expect(d.substanceDensity).toBe(5);
    expect(d.format).toBe("tutorial");
  });

  it("should fold every valid subjectTier into qualified leading topics", () => {
    // The tier enums are schema-forced (nano won't compose qualified tags
    // reliably as free text); the deterministic fold here is what lets
    // profile tags like "comedic chess" match. Multi-select because a
    // low-elo blunder recap is BOTH comedic and amateur, and the translator
    // may pick either word for "low tier comic chess".
    const d = clampDigest({
      ...RAW_OK,
      subjectTiers: ["comedic", "amateur"],
      topics: ["Chess", "blunders"],
    })!;
    expect(d.topics.slice(0, 2)).toEqual(["comedic chess", "amateur chess"]);
    expect(d.topics).toContain("chess");
  });

  it("should ignore invalid, empty, or absent subjectTiers", () => {
    expect(clampDigest({ ...RAW_OK, subjectTiers: [] })!.topics).toEqual(["chess", "endgames"]);
    expect(clampDigest({ ...RAW_OK, subjectTiers: ["funny"] })!.topics).toEqual(["chess", "endgames"]);
    expect(clampDigest({ ...RAW_OK, subjectTiers: "elite" })!.topics).toEqual(["chess", "endgames"]);
    expect(clampDigest(RAW_OK)!.topics).toEqual(["chess", "endgames"]);
  });

  it("should not duplicate an existing qualified tag and should respect the topics cap", () => {
    const dupe = clampDigest({ ...RAW_OK, subjectTiers: ["elite"], topics: ["elite chess", "chess"] })!;
    expect(dupe.topics.filter((t) => t === "elite chess")).toHaveLength(1);
    const full = clampDigest({
      ...RAW_OK,
      subjectTiers: ["amateur", "comedic"],
      topics: ["chess", "b", "c", "d", "e", "f", "g", "h"],
    })!;
    expect(full.topics.slice(0, 2)).toEqual(["amateur chess", "comedic chess"]);
    expect(full.topics).toHaveLength(8);
  });

  it("should clamp numeric fields into 1-5 and round to integers", () => {
    const d = clampDigest({ ...RAW_OK, substanceDensity: 9, novelty: 0, claimOverreach: 3.6 })!;
    expect(d.substanceDensity).toBe(5);
    expect(d.novelty).toBe(1);
    expect(d.claimOverreach).toBe(4);
  });

  it("should map unknown format and tone onto the fallback vocabulary entries", () => {
    const d = clampDigest({ ...RAW_OK, format: "Shopping Haul", emotionalTone: "SCREAMING" })!;
    expect(d.format).toBe("other");
    expect(d.emotionalTone).toBe("neutral");
    expect(DIGEST_FORMATS).toContain("other");
    expect(DIGEST_TONES).toContain("neutral");
  });

  it("should cap topics at 8 and drop non-string entries", () => {
    const d = clampDigest({
      ...RAW_OK,
      topics: ["a", "b", "c", "d", "e", "f", "g", "h", "i", 42, null],
    })!;
    expect(d.topics).toHaveLength(8);
  });

  it("should cap the summary length", () => {
    const d = clampDigest({ ...RAW_OK, summary: "x".repeat(1000) })!;
    expect(d.summary.length).toBeLessThanOrEqual(400);
  });

  it("should return null when a numeric field is missing or non-numeric", () => {
    const { novelty: _novelty, ...missing } = RAW_OK;
    expect(clampDigest(missing)).toBeNull();
    expect(clampDigest({ ...RAW_OK, substanceDensity: "high" })).toBeNull();
    expect(clampDigest(null)).toBeNull();
    expect(clampDigest("nope")).toBeNull();
  });
});
