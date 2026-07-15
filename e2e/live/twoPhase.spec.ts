// Live tier: two-phase scoring against real providers. Structural
// assertions only — curation quality is judged by eyeball on a real feed
// (see docs/TWO_PHASE_SCORING.md migration step 5).
import { test, expect } from "@playwright/test";
import type { Provider } from "../../src/lib/types";
import { enrichBatch, translateProfile } from "../../src/services/scoring/twoPhase";
import { ENRICH_TRANSCRIPT_CHARS } from "../../src/services/scoring/enrichPrompt";
import { fetchTranscriptExcerpt } from "../../src/services/youtube/transcripts";
import { DIGEST_NUMERIC_FIELDS } from "../../src/lib/types";
import { isEmptyTarget } from "../../src/lib/rubricScorer";
import { ENRICH_ANTHROPIC_MODEL, ENRICH_OPENAI_MODEL } from "../../src/services/scoring/twoPhase";

const CAPTIONED_VIDEO = "jNQXAC9IVRw"; // "Me at the zoo" — stable since 2005

const PROVIDERS: Array<{ provider: Provider; envVar: string; model: string }> = [
  { provider: "anthropic", envVar: "ANTHROPIC_API_KEY", model: ENRICH_ANTHROPIC_MODEL },
  { provider: "openai", envVar: "OPENAI_API_KEY", model: ENRICH_OPENAI_MODEL },
];

for (const { provider, envVar, model } of PROVIDERS) {
  test(`should digest a real video with a real transcript via ${provider} (${model})`, async () => {
    const apiKey = process.env[envVar];
    test.skip(!apiKey, `${envVar} not set — live tier needs .env.production or env keys`);

    const outcome = await fetchTranscriptExcerpt(CAPTIONED_VIDEO, ENRICH_TRANSCRIPT_CHARS);
    expect(outcome).toHaveProperty("excerpt");
    const transcript = "excerpt" in outcome ? outcome.excerpt : null;

    const digests = await enrichBatch(
      [
        {
          video: {
            id: CAPTIONED_VIDEO,
            source: "home",
            title: "Me at the zoo",
            channelTitle: "jawed",
            channelId: null,
            durationText: "0:19",
            durationSec: 19,
            publishedText: "19 years ago",
            publishedAtApprox: null,
            viewCountText: "300M views",
            viewCount: null,
            thumbnailUrl: null,
            descriptionSnippet: null,
            isLive: false,
          },
          transcript,
        },
      ],
      provider,
      apiKey!,
      model,
    );

    const digest = digests.get(CAPTIONED_VIDEO);
    expect(digest, "digest returned for the requested id").toBeDefined();
    for (const field of DIGEST_NUMERIC_FIELDS) {
      expect(digest![field]).toBeGreaterThanOrEqual(1);
      expect(digest![field]).toBeLessThanOrEqual(5);
    }
    expect(digest!.topics.length).toBeGreaterThan(0);
    expect(digest!.summary.length).toBeGreaterThan(10);
    // A 19-second casual zoo clip is nobody's overclaiming provocation.
    expect(digest!.claimOverreach).toBeLessThanOrEqual(2);
  });

  test(`should translate an anti-provocateur profile into a claimOverreach constraint via ${provider}`, async () => {
    const apiKey = process.env[envVar];
    test.skip(!apiKey, `${envVar} not set — live tier needs .env.production or env keys`);

    const target = await translateProfile(
      {
        moreOf: "deep chess analysis, careful science explainers",
        lessOf: "science provocateurs, overclaiming hype, clickbait",
        updatedAt: 0,
      },
      [],
      provider,
      apiKey!,
      model,
    );

    expect(isEmptyTarget(target)).toBe(false);
    expect(target.topicsMore.items.length).toBeGreaterThan(0);
    const overreach = target.fields.claimOverreach;
    expect(overreach, "claimOverreach constrained by an anti-BS profile").toBeDefined();
    expect(overreach!.target).toBeLessThanOrEqual(2);
    expect(overreach!.importance).toBeGreaterThanOrEqual(5);
  });

  test(`should keep tier qualifiers and skip the bare parent tag via ${provider}`, async () => {
    const apiKey = process.env[envVar];
    test.skip(!apiKey, `${envVar} not set — live tier needs .env.production or env keys`);

    // The gotham mis-ranking profile: interest restricted to a tier of
    // chess, the opposite tier avoided. A bare "chess" seek tag would make
    // every chess video on-profile (translator prompt v3 forbids it).
    const target = await translateProfile(
      {
        moreOf: "Chess videos featuring top tier play or top computer engine games of note.",
        lessOf: "Low tier comic chess games.",
        updatedAt: 0,
      },
      [],
      provider,
      apiKey!,
      model,
    );

    expect(target.topicsMore.items.length).toBeGreaterThan(0);
    expect(target.topicsMore.items).not.toContain("chess");
    expect(target.topicsLess.items.length).toBeGreaterThan(0);
  });
}
