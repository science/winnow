import { test } from "@playwright/test";
import {
  clickVideoCard,
  expectCardTextHasRoom,
  expectClosePlayerTappable,
  expectInlinePlayerUnder,
  expectNoSidewaysScroll,
  expectVoteButtonsTappable,
  openFeedDemo,
  openOnboarding,
  openSettingsDemo,
  waitForScoredFeed,
} from "../helpers";

// Runs in the phone-sized project only (playwright.config.ts): a 360px-wide
// touch screen, the narrow end of what Firefox for Android is used on.
const FIRST_TOP = "How Winnowing Works";

test("should fit the feed on a phone screen with room for titles", async ({ page }) => {
  await openFeedDemo(page);
  await waitForScoredFeed(page);

  await expectNoSidewaysScroll(page);
  await expectCardTextHasRoom(page);
});

test("should give touch users buttons big enough to hit", async ({ page }) => {
  await openFeedDemo(page);
  await waitForScoredFeed(page);

  await expectVoteButtonsTappable(page);

  await clickVideoCard(page, FIRST_TOP);
  await expectInlinePlayerUnder(page, FIRST_TOP);
  await expectClosePlayerTappable(page);
  await expectNoSidewaysScroll(page);
});

test("should fit settings and onboarding on a phone screen", async ({ page }) => {
  await openSettingsDemo(page);
  await expectNoSidewaysScroll(page);

  await openOnboarding(page);
  await expectNoSidewaysScroll(page);
});
