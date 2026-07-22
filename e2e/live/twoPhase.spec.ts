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

  test(`should not tier a celebrity-crossover exhibition as elite via ${provider}`, async () => {
    const apiKey = process.env[envVar];
    test.skip(!apiKey, `${envVar} not set — live tier needs .env.production or env keys`);

    // The 2026-07-21 Tyler1/Faker mis-tier: famous non-chess players in a
    // casual exhibition, commentary calling them legendary, got subjectTier
    // "elite" — which token-matched an "elite chess" seek tag. Synthetic
    // transcript (stable fixture); the fame trap rides in the commentary,
    // exactly how it reaches the model in production.
    const transcript = [
      "Welcome back everybody, today we have the most insane crossover in chess history.",
      "In one corner, the greatest esports player of all time, an absolute legend of League of Legends.",
      "In the other, the most famous streamer on the planet. Neither of them is titled — ",
      "both picked up chess about a year ago and it shows.",
      "He opens with the queen's pawn, and — oh no, he's already hanging the bishop on move four.",
      "His opponent doesn't see it! Takes three moves to notice the free piece. The chat is losing it.",
      "Now a wild king walk for no reason. This is not theory, folks, this is pure chaos and it's beautiful.",
      "He blunders the queen, laughs, offers a rematch. What a spectacle between two legends of gaming.",
    ].join(" ");
    const digests = await enrichBatch(
      [
        {
          video: {
            id: "synthxover01",
            source: "home",
            title: "GAMING LEGENDS INSANE CHESS BATTLE",
            channelTitle: "ChessRecapChannel",
            channelId: null,
            durationText: "21:30",
            durationSec: 1290,
            publishedText: "12 hours ago",
            publishedAtApprox: null,
            viewCountText: "145K views",
            viewCount: 145000,
            thumbnailUrl: null,
            descriptionSnippet: "Two gaming superstars face off over the board.",
            isLive: false,
          },
          transcript,
        },
      ],
      provider,
      apiKey!,
      model,
    );

    const digest = digests.get("synthxover01");
    expect(digest, "digest returned for the requested id").toBeDefined();
    const eliteTagged = digest!.topics.some((t) => t.split(/\s+/).includes("elite"));
    expect(eliteTagged, `fame in another domain must not tier as elite (topics: ${digest!.topics.join(", ")})`).toBe(false);
    const lowRegister = digest!.topics.some((t) => {
      const words = t.split(/\s+/);
      return words.includes("casual") || words.includes("comedic") || words.includes("amateur");
    });
    expect(lowRegister, `a celebrity exhibition must carry a casual/comedic/amateur tier (topics: ${digest!.topics.join(", ")})`).toBe(true);
  });

  test(`should span a rejected register across tier qualifiers via ${provider}`, async () => {
    const apiKey = process.env[envVar];
    test.skip(!apiKey, `${envVar} not set — live tier needs .env.production or env keys`);

    // The real profile behind the Tyler1/Faker report (verbatim). "Low tier
    // comic chess games" must cover the whole register — comedic plus at
    // least one of casual/amateur — because tier matching is exact per
    // qualifier word and a missing variant is a hole in the filter.
    const target = await translateProfile(
      {
        moreOf:
          "Chess videos featuring top tier play or top computer engine games of note.  Science and civil/mechanical/real-world engineering that is practical, professional or serious. Art, film, history, anthropology. Cinematic and film studies. Previews of good quality movies.",
        lessOf:
          "Computer science content, video games, sports, politics. Low tier comic chess games. Drama narratives on any subject. Click-bait subjects or attention grabbing material. Standup comedy. Science provocateurs, overclaiming hype. Overhyped or sensational movies or trailers.",
        updatedAt: 0,
      },
      [],
      provider,
      apiKey!,
      model,
    );

    expect(target.topicsMore.items).toContain("elite chess");
    expect(target.topicsLess.items).toContain("comedic chess");
    const spansRegister = ["casual chess", "amateur chess"].some((t) =>
      target.topicsLess.items.includes(t),
    );
    expect(spansRegister, `avoid list must span the low register (got: ${target.topicsLess.items.join(", ")})`).toBe(true);
  });
}
