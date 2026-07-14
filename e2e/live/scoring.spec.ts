// Live tier: real provider calls with keys from .env.production. Skips
// gracefully when a key is absent (house rule: free tier never needs keys).
import { test, expect } from "@playwright/test";
import { expectNoFeedError, openFeedWithLiveSeed, waitForStoredScores } from "../helpers/live";
import { BAIT_ID, LIVE_PROFILE, LIVE_VIDEOS, NEUTRAL_ID, SUBSTANCE_ID } from "./fixtures";
import type { Provider } from "../../src/lib/types";

const ALL_IDS = [SUBSTANCE_ID, BAIT_ID, NEUTRAL_ID];

const PROVIDERS: Array<{ provider: Provider; envVar: string }> = [
  { provider: "anthropic", envVar: "ANTHROPIC_API_KEY" },
  { provider: "openai", envVar: "OPENAI_API_KEY" },
];

for (const { provider, envVar } of PROVIDERS) {
  test(`should score seeded videos end-to-end with ${provider}`, async ({ page }) => {
    const apiKey = process.env[envVar];
    test.skip(!apiKey, `${envVar} not set — live tier needs .env.production or env keys`);

    await openFeedWithLiveSeed(page, {
      provider,
      apiKey: apiKey!,
      profile: LIVE_PROFILE,
      videos: LIVE_VIDEOS,
    });

    const scores = await waitForStoredScores(page, ALL_IDS);
    await expectNoFeedError(page);

    for (const id of ALL_IDS) {
      const s = scores[id]!;
      expect(Number.isInteger(s.score), `${id} score is an integer`).toBe(true);
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
      expect(s.reason.length, `${id} has a reason`).toBeGreaterThan(0);
      expect(typeof s.clickbait).toBe("boolean");
    }

    // The product claim, with extreme contrast so it's stable: an on-profile
    // deep dive must outscore shock-value drama bait.
    expect(scores[SUBSTANCE_ID]!.score).toBeGreaterThan(scores[BAIT_ID]!.score);
    expect(scores[BAIT_ID]!.clickbait, "bait video flagged as clickbait").toBe(true);
  });

  test(`should score with a feedback section present using ${provider}`, async ({ page }) => {
    const apiKey = process.env[envVar];
    test.skip(!apiKey, `${envVar} not set — live tier needs .env.production or env keys`);

    // Only structural assertions here: the prompt with a <feedback> block
    // must still parse into schema-valid scores on the real provider.
    // Directional would be flaky at this sample size.
    await openFeedWithLiveSeed(page, {
      provider,
      apiKey: apiKey!,
      profile: LIVE_PROFILE,
      videos: LIVE_VIDEOS,
      feedback: [
        {
          videoId: "votedgone01",
          vote: "down",
          votedAt: Date.now() - 60_000,
          title: "Top 10 SHOCKING Celebrity Meltdowns",
          channelTitle: "Gossip Feed",
          durationText: "7:15",
          source: "home",
          descriptionSnippet: null,
          score: 40,
          reason: "engagement bait",
          clickbait: true,
        },
        {
          videoId: "votedgone02",
          vote: "up",
          votedAt: Date.now() - 30_000,
          title: "Building a CPU from NAND gates: full walkthrough",
          channelTitle: "Hardware from Scratch",
          durationText: "58:00",
          source: "subscriptions",
          descriptionSnippet: null,
          score: 82,
          reason: "substantive",
          clickbait: false,
        },
      ],
    });

    const scores = await waitForStoredScores(page, ALL_IDS);
    await expectNoFeedError(page);

    for (const id of ALL_IDS) {
      const s = scores[id]!;
      expect(Number.isInteger(s.score), `${id} score is an integer`).toBe(true);
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
      expect(s.reason.length, `${id} has a reason`).toBeGreaterThan(0);
    }
  });
}
