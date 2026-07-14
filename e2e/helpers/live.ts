// Live-tier helpers: seed the plain-browser localStorage fallback so the
// built page scores seeded fixture videos with a REAL provider key — no
// YouTube session needed (fresh fetchedAt keeps initFeed inside the TTL).
import { expect, type Page } from "@playwright/test";
import type { Profile, Provider, Settings, Video, VideoScore } from "../../src/lib/types";

export interface LiveSeed {
  provider: Provider;
  apiKey: string;
  profile: Pick<Profile, "moreOf" | "lessOf">;
  videos: Video[];
}

export async function openFeedWithLiveSeed(page: Page, seed: LiveSeed): Promise<void> {
  const settings: Settings = {
    provider: seed.provider,
    anthropicApiKey: seed.provider === "anthropic" ? seed.apiKey : null,
    openaiApiKey: seed.provider === "openai" ? seed.apiKey : null,
  };
  const profile: Profile = { ...seed.profile, updatedAt: Date.now() };
  await page.addInitScript(
    (state) => {
      localStorage.clear();
      localStorage.setItem("winnow:settings:v1", JSON.stringify(state.settings));
      localStorage.setItem("winnow:profile:v1", JSON.stringify(state.profile));
      localStorage.setItem("winnow:videos:v1", JSON.stringify(state.videos));
    },
    { settings, profile, videos: { fetchedAt: Date.now(), videos: seed.videos } },
  );
  await page.goto("/feed.html");
}

interface StoredScores {
  profileHash: string;
  scores: Record<string, VideoScore>;
}

/** Poll persisted scores until every id has one (or the test times out). */
export async function waitForStoredScores(
  page: Page,
  ids: string[],
  timeoutMs = 90_000,
): Promise<Record<string, VideoScore>> {
  await expect
    .poll(
      async () => {
        const raw = await page.evaluate(() => localStorage.getItem("winnow:scores:v1"));
        if (!raw) return 0;
        const stored = JSON.parse(raw) as StoredScores;
        return ids.filter((id) => stored.scores[id]).length;
      },
      { timeout: timeoutMs, message: `scores for ${ids.join(", ")}` },
    )
    .toBe(ids.length);
  const raw = await page.evaluate(() => localStorage.getItem("winnow:scores:v1"));
  return (JSON.parse(raw!) as StoredScores).scores;
}

export async function expectNoFeedError(page: Page): Promise<void> {
  await expect(page.getByTestId("feed-error")).not.toBeVisible();
}
