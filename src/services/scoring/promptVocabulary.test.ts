// The translator and the enricher are separate LLM calls that must agree on
// qualifier wording, or qualified profile tags never token-match digest
// topics ("top tier chess" vs "elite chess" — observed in the 2026-07
// gotham diag run: 3 seek hits across 125 videos). Both prompts must
// interpolate the same canonical tier/style vocabulary.
import { describe, it, expect } from "vitest";
import { DIGEST_TIER_QUALIFIERS } from "../../lib/digest";
import { ENRICH_SYSTEM_PROMPT } from "./enrichPrompt";
import { TRANSLATE_SYSTEM_PROMPT } from "./translatePrompt";

describe("shared tier-qualifier vocabulary", () => {
  it("should offer a small canonical qualifier list", () => {
    expect(DIGEST_TIER_QUALIFIERS.length).toBeGreaterThanOrEqual(4);
    for (const q of DIGEST_TIER_QUALIFIERS) {
      expect(q).toMatch(/^[a-z]+$/);
    }
  });

  it("should interpolate every qualifier into both the enrich and translate prompts", () => {
    for (const q of DIGEST_TIER_QUALIFIERS) {
      expect(ENRICH_SYSTEM_PROMPT).toContain(q);
      expect(TRANSLATE_SYSTEM_PROMPT).toContain(q);
    }
  });
});
