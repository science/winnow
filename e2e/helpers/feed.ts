// All selectors for the feed surface live HERE, not in specs (house rule).
import { expect, type Page } from "@playwright/test";

export async function openFeedDemo(page: Page): Promise<void> {
  await page.goto("/feed.html?demo=1");
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
