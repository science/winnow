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
}
