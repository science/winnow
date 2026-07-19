// Live tier: go-deeper query generation against real providers. The plain
// browser can't fetch youtube.com/results (CORS — only the extension's host
// permissions allow that), so the searches themselves degrade to warnings;
// this spec asserts the LLM half: a real provider turns the profile into a
// persisted, well-formed query pool. Costs one cheap call per provider.
import { test, expect } from "@playwright/test";
import { openFeedWithLiveSeed } from "../helpers/live";
import { clickGoDeeper } from "../helpers/feed";
import { LIVE_PROFILE, LIVE_VIDEOS } from "./fixtures";
import type { Provider } from "../../src/lib/types";

const PROVIDERS: Array<{ provider: Provider; envVar: string }> = [
  { provider: "anthropic", envVar: "ANTHROPIC_API_KEY" },
  { provider: "openai", envVar: "OPENAI_API_KEY" },
];

async function readQueryPool(page: import("@playwright/test").Page): Promise<string[] | null> {
  return page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("winnow:profiles:v1") ?? "null") as {
      activeProfileId: string;
    } | null;
    if (!state) return null;
    const raw = localStorage.getItem(`winnow:discoverQueries:v1:${state.activeProfileId}`);
    if (!raw) return null;
    const pool = JSON.parse(raw) as { queries: { text: string }[] };
    return pool.queries.map((q) => q.text);
  });
}

for (const { provider, envVar } of PROVIDERS) {
  test(`should generate a persisted search-query pool from ${provider}`, async ({ page }) => {
    const apiKey = process.env[envVar];
    test.skip(!apiKey, `${envVar} not set — live tier needs .env.production or env keys`);

    await openFeedWithLiveSeed(page, {
      provider,
      apiKey: apiKey!,
      profile: LIVE_PROFILE,
      videos: LIVE_VIDEOS,
    });
    await clickGoDeeper(page);

    await expect
      .poll(async () => (await readQueryPool(page))?.length ?? 0, {
        timeout: 60_000,
        message: "query pool generated and persisted",
      })
      .toBeGreaterThanOrEqual(4);

    const queries = (await readQueryPool(page))!;
    expect(queries.length).toBeLessThanOrEqual(12);
    for (const q of queries) {
      expect(q.trim().length).toBeGreaterThan(0);
      expect(q.length).toBeLessThan(200);
    }
    console.log(`[live] ${provider} generated queries:\n  ${queries.join("\n  ")}`);
  });
}
