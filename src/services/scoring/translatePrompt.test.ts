import { describe, it, expect } from "vitest";
import { TRANSLATE_SYSTEM_PROMPT } from "./translatePrompt";
import { TARGET_TOPICS_MAX } from "../../lib/rubricScorer";
import { DIGEST_TIER_QUALIFIERS } from "../../lib/digest";

describe("TRANSLATE_SYSTEM_PROMPT", () => {
  it("should state the same per-list topic cap that canonicalizeTarget enforces", () => {
    // The 2026-07-19 dropped-subject bug: the prompt capped topics at 8 while
    // the client accepted 12, and the model silently discarded whole subjects
    // (art, history, science) to fit.
    expect(TRANSLATE_SYSTEM_PROMPT).toContain(`At most ${TARGET_TOPICS_MAX} per list`);
  });

  it("should require covering every distinct subject before qualifier variants", () => {
    expect(TRANSLATE_SYSTEM_PROMPT.toLowerCase()).toContain("every distinct subject");
  });

  it("should interpolate the canonical tier-qualifier vocabulary", () => {
    expect(TRANSLATE_SYSTEM_PROMPT).toContain(DIGEST_TIER_QUALIFIERS.join(", "));
  });

  it("should span a rejected register across every applicable tier qualifier", () => {
    // Tier matching is exact per qualifier word: an avoid list of only
    // "comedic chess" + "amateur chess" lets a digest correctly tagged
    // "casual chess" (celebrity exhibition, not played for laughs) escape
    // the avoid cap — the 2026-07-21 Tyler1/Faker gap.
    expect(TRANSLATE_SYSTEM_PROMPT).toContain('"casual chess"');
    expect(TRANSLATE_SYSTEM_PROMPT).toContain('"amateur chess"');
  });

  it("should tell the translator how to use digest-bearing votes", () => {
    expect(TRANSLATE_SYSTEM_PROMPT).toContain("digest");
  });
});
