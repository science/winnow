import { describe, it, expect } from "vitest";
import { describeTarget } from "./targetDisplay";
import { EMPTY_TARGET } from "./rubricScorer";
import type { ProfileTarget } from "./types";

describe("describeTarget", () => {
  it("should render constrained axes with aim and importance", () => {
    const target: ProfileTarget = {
      ...EMPTY_TARGET,
      fields: {
        substanceDensity: { target: 5, importance: 9 },
        claimOverreach: { target: 1, importance: 8 },
      },
    };
    const lines = describeTarget(target);
    expect(lines).toContain("Substance density: aim 5/5 — importance 9/10");
    expect(lines).toContain("Claim overreach: aim 1/5 — importance 8/10");
    expect(lines).toHaveLength(2);
  });

  it("should render topic and format/tone lists with their importance", () => {
    const target: ProfileTarget = {
      ...EMPTY_TARGET,
      topicsMore: { items: ["top tier chess", "engineering"], importance: 9 },
      topicsLess: { items: ["comic chess"], importance: 8 },
      formatsAvoid: { items: ["reaction"], importance: 5 },
      tonesAvoid: { items: ["outraged", "dramatic"], importance: 6 },
    };
    expect(describeTarget(target)).toEqual([
      "Topics sought: top tier chess, engineering — importance 9/10",
      "Topics avoided: comic chess — importance 8/10",
      "Formats avoided: reaction — importance 5/10",
      "Tones avoided: outraged, dramatic — importance 6/10",
    ]);
  });

  it("should return no lines for an empty target", () => {
    expect(describeTarget(EMPTY_TARGET)).toEqual([]);
  });
});
