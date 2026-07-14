import { test, expect } from "@playwright/test";
import {
  openFeedDemo,
  waitForScoredFeed,
  getTierVideoTitles,
  getWinnowedFoldText,
  clickWinnowedFold,
  clickFirstVideoInTier,
  expectWatchViewForSomeVideo,
  expectStartOnOpenEmbed,
  clickBackToFeed,
  expectFeedBottomMarker,
} from "../helpers";

// Demo fixtures score deterministically (stub scorer, fnv1a of videoId):
// "How Winnowing Works" (93) and "The Recommended Video…" (87) → Top picks;
// "Harvest Livestream" (21, clickbait) → Winnowed out.

test("should bucket demo videos into tiers with the bait behind the fold", async ({ page }) => {
  await openFeedDemo(page);
  await waitForScoredFeed(page);

  const top = await getTierVideoTitles(page, "top");
  expect(top).toHaveLength(2);
  expect(top.join(" ")).toContain("How Winnowing Works");
  expect(top.join(" ")).toContain("The Recommended Video That Is Actually Good");

  // Winnowed videos are folded away, not shown — and never deleted.
  expect(await getWinnowedFoldText(page)).toMatch(/1 video winnowed out/i);
  await clickWinnowedFold(page);
  const winnowed = await getTierVideoTitles(page, "winnowed");
  expect(winnowed.join(" ")).toContain("Harvest Livestream");

  await expectFeedBottomMarker(page);
});

test("should open the watch view from a card with start-on-open playback, and return", async ({ page }) => {
  await openFeedDemo(page);
  await waitForScoredFeed(page);

  await clickFirstVideoInTier(page, "top");
  await expectWatchViewForSomeVideo(page);
  await expectStartOnOpenEmbed(page);

  await clickBackToFeed(page);
  await waitForScoredFeed(page);
});

test("should mark a video watched after viewing it", async ({ page }) => {
  await openFeedDemo(page);
  await waitForScoredFeed(page);
  await clickFirstVideoInTier(page, "top");
  await expectWatchViewForSomeVideo(page);
  await clickBackToFeed(page);
  await waitForScoredFeed(page);
  // Watched cards show the checkmark and sink to the bottom of their tier.
  const top = await getTierVideoTitles(page, "top");
  expect(top[top.length - 1]).toMatch(/✓/);
});
