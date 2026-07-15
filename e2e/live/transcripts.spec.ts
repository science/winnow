// Live tier: the transcript pipeline against real YouTube. Needs network but
// no API keys. Runs the production module directly (the pipeline is plain
// fetch — the only extension-specific ingredient is the DNR Origin rewrite,
// whose absence in Node matches its effect in Firefox: no moz-extension
// Origin reaches YouTube either way).
import { test, expect } from "@playwright/test";
import { fetchTranscriptExcerpt } from "../../src/services/youtube/transcripts";

// "Me at the zoo" — public, captioned, unchanged since 2005.
const CAPTIONED_VIDEO = "jNQXAC9IVRw";

test("should fetch a real transcript excerpt via the ANDROID player route", async () => {
  const outcome = await fetchTranscriptExcerpt(CAPTIONED_VIDEO, 500);
  expect(outcome, `pipeline failed: ${JSON.stringify(outcome)}`).toHaveProperty("excerpt");
  if ("excerpt" in outcome) {
    expect(outcome.source).toBe("player");
    expect(outcome.excerpt.toLowerCase()).toContain("elephant");
  }
});

test("should report a failure stage, not throw, for an invalid video id", async () => {
  const outcome = await fetchTranscriptExcerpt("aaaaaaaaaaa", 500);
  expect(outcome).toHaveProperty("failure");
});
