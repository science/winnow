// All selectors for the feed surface live HERE, not in specs (house rule).
import { expect, type Page } from "@playwright/test";
import type { Video } from "../../src/lib/types";

export async function openFeedDemo(page: Page): Promise<void> {
  await page.goto("/feed.html?demo=1");
}

/** Fill out the full Video shape from the fields a spec cares about. */
export function demoVideo(partial: Pick<Video, "id" | "source" | "title"> & Partial<Video>): Video {
  return {
    channelTitle: "Demo Channel",
    channelId: null,
    durationText: "12:00",
    durationSec: 720,
    publishedText: "2 days ago",
    publishedAtApprox: null,
    viewCountText: "100K views",
    viewCount: 100_000,
    thumbnailUrl: null,
    descriptionSnippet: null,
    isLive: false,
    ...partial,
  };
}

/** Open demo mode with seeded videos instead of the built-in fixtures —
 * a fresh fetchedAt keeps initFeed inside the TTL so nothing refetches. */
export async function openFeedDemoWithSeed(
  page: Page,
  videos: Video[],
  opts: { slow?: boolean } = {},
): Promise<void> {
  await page.addInitScript(
    (state) => {
      localStorage.clear();
      localStorage.setItem("winnow:videos:v1", JSON.stringify(state.videos));
    },
    { videos: { fetchedAt: Date.now(), videos } },
  );
  await page.goto(`/feed.html?demo=1${opts.slow ? "&slow=1" : ""}`);
}

export async function openOnboarding(page: Page): Promise<void> {
  await page.goto("/feed.html");
}

export async function waitForScoredFeed(page: Page): Promise<void> {
  // Scoring is stubbed in demo mode; tiers appear once scores land.
  await expect(page.getByTestId("tier-top")).toBeVisible({ timeout: 10_000 });
}

export async function getTierVideoTitles(page: Page, tier: "top" | "worth" | "winnowed"): Promise<string[]> {
  const cards = page.getByTestId(`tier-${tier}`).getByTestId("video-card");
  return cards.locator("h3").allInnerTexts();
}

export async function getWinnowedFoldText(page: Page): Promise<string> {
  return page.getByTestId("winnowed-fold").innerText();
}

export async function clickWinnowedFold(page: Page): Promise<void> {
  await page.getByTestId("winnowed-fold").click();
}

export async function clickFirstVideoInTier(page: Page, tier: "top" | "worth" | "winnowed"): Promise<void> {
  await page.getByTestId(`tier-${tier}`).getByTestId("video-card").first().click();
}

export async function expectUnvettedFoldVisible(page: Page): Promise<void> {
  await expect(page.getByTestId("unvetted-fold")).toBeVisible();
}

export async function getUnvettedFoldText(page: Page): Promise<string> {
  return page.getByTestId("unvetted-fold").innerText();
}

export async function clickUnvettedFold(page: Page): Promise<void> {
  await page.getByTestId("unvetted-fold").click();
}

export async function getUnvettedVideoTitles(page: Page): Promise<string[]> {
  const cards = page.getByTestId("tier-unvetted").getByTestId("video-card");
  return cards.locator("h3").allInnerTexts();
}

/** The named video renders no visible card anywhere on the page. */
export async function expectVideoCardHidden(page: Page, title: string): Promise<void> {
  await expect(page.getByTestId("video-card").filter({ hasText: title })).not.toBeVisible();
}

export async function expectVideoCardVisible(page: Page, title: string): Promise<void> {
  await expect(page.getByTestId("video-card").filter({ hasText: title })).toBeVisible();
}

export async function expectRetryScoringHidden(page: Page): Promise<void> {
  await expect(page.getByTestId("retry-scoring")).not.toBeVisible();
}

export async function expectRetryScoringInsideUnvettedFold(page: Page): Promise<void> {
  await expect(page.getByTestId("tier-unvetted").getByTestId("retry-scoring")).toBeVisible();
}

export async function expectScoringProgressVisible(page: Page): Promise<void> {
  await expect(page.getByTestId("scoring-progress")).toBeVisible();
}

export async function expectScoringProgressHidden(page: Page): Promise<void> {
  await expect(page.getByTestId("scoring-progress")).not.toBeVisible({ timeout: 15_000 });
}

export async function expectTranscriptCoverageHidden(page: Page): Promise<void> {
  await expect(page.getByTestId("transcript-coverage")).not.toBeVisible();
}

export async function expectWatchViewForSomeVideo(page: Page): Promise<void> {
  await expect(page.locator("iframe[src*='youtube-nocookie.com/embed/']")).toBeVisible();
}

export async function expectNoAutoplayInEmbed(page: Page): Promise<void> {
  const src = await page.locator("iframe[src*='youtube-nocookie.com']").getAttribute("src");
  expect(src).not.toContain("autoplay");
}

export async function clickBackToFeed(page: Page): Promise<void> {
  await page.getByRole("link", { name: /back to feed/i }).click();
}

export async function expectOnboardingVisible(page: Page): Promise<void> {
  await expect(page.getByTestId("onboarding")).toBeVisible();
}

export async function getOnboardingMissingText(page: Page): Promise<string> {
  return page.getByTestId("onboarding-missing").innerText();
}

/** The feed surface replaced onboarding (regardless of fetch outcome). */
export async function expectFeedSurfaceVisible(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: /refresh/i })).toBeVisible();
  await expect(page.getByTestId("onboarding")).not.toBeVisible();
}

export async function expectFeedBottomMarker(page: Page): Promise<void> {
  await expect(page.getByText(/the page has a bottom/i)).toBeVisible();
}
