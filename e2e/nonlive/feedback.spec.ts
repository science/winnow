import { test, expect } from "@playwright/test";
import {
  openFeedDemo,
  waitForScoredFeed,
  clickWinnowedFold,
  voteOnVideo,
  getVotePressedState,
  expectVideoInTier,
  expectVideoNotInTier,
} from "../helpers";

// Demo fixtures (deterministic stub scorer): "How Winnowing Works" scores
// into Top picks; "Harvest Livestream" scores 21 + clickbait → Winnowed out.
const TOP_TITLE = "How Winnowing Works";
const WINNOWED_TITLE = "Harvest Livestream";

test("should demote a downvoted top pick into the winnowed fold immediately", async ({ page }) => {
  await openFeedDemo(page);
  await waitForScoredFeed(page);
  await expectVideoInTier(page, "top", TOP_TITLE);

  await voteOnVideo(page, TOP_TITLE, "down");

  await expectVideoNotInTier(page, "top", TOP_TITLE);
  await clickWinnowedFold(page);
  await expectVideoInTier(page, "winnowed", TOP_TITLE);
  expect(await getVotePressedState(page, TOP_TITLE, "down")).toBe(true);
});

test("should promote an upvoted winnowed video into top picks", async ({ page }) => {
  await openFeedDemo(page);
  await waitForScoredFeed(page);

  await clickWinnowedFold(page);
  await expectVideoInTier(page, "winnowed", WINNOWED_TITLE);
  await voteOnVideo(page, WINNOWED_TITLE, "up");

  await expectVideoInTier(page, "top", WINNOWED_TITLE);
  expect(await getVotePressedState(page, WINNOWED_TITLE, "up")).toBe(true);
});

test("should persist votes across a reload", async ({ page }) => {
  await openFeedDemo(page);
  await waitForScoredFeed(page);
  await voteOnVideo(page, TOP_TITLE, "down");
  await expectVideoNotInTier(page, "top", TOP_TITLE);

  await page.reload();
  await waitForScoredFeed(page);

  await expectVideoNotInTier(page, "top", TOP_TITLE);
  await clickWinnowedFold(page);
  await expectVideoInTier(page, "winnowed", TOP_TITLE);
  expect(await getVotePressedState(page, TOP_TITLE, "down")).toBe(true);
});

test("should clear a vote when the same button is clicked again", async ({ page }) => {
  await openFeedDemo(page);
  await waitForScoredFeed(page);
  await voteOnVideo(page, TOP_TITLE, "down");
  await expectVideoNotInTier(page, "top", TOP_TITLE);

  await clickWinnowedFold(page);
  await voteOnVideo(page, TOP_TITLE, "down");

  await expectVideoInTier(page, "top", TOP_TITLE);
  expect(await getVotePressedState(page, TOP_TITLE, "down")).toBe(false);
});
