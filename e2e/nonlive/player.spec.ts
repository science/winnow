import { test } from "@playwright/test";
import {
  clickFirstVideoInTier,
  clickVideoCard,
  closeInlinePlayer,
  expectFeedStillVisible,
  expectFirstVideoInTier,
  expectInlinePlayerOpen,
  expectInlinePlayerUnder,
  expectLastVideoInTier,
  expectNoInlinePlayer,
  expectPlayerFrameSurvived,
  expectSinglePlayerOpen,
  expectStartOnOpenEmbed,
  openFeedDemo,
  openFeedDemoAtWatch,
  stampPlayerFrame,
  voteOnVideo,
  waitForScoredFeed,
} from "../helpers";

// Demo fixtures score deterministically: "How Winnowing Works" (abc123DEF45)
// and "The Recommended Video That Is Actually Good" are the two Top picks.
const FIRST_TOP = "How Winnowing Works";
const FIRST_TOP_ID = "abc123DEF45";
const SECOND_TOP = "The Recommended Video That Is Actually Good";

test("should expand a player directly below the clicked card without leaving the feed", async ({ page }) => {
  await openFeedDemo(page);
  await waitForScoredFeed(page);

  await clickVideoCard(page, FIRST_TOP);

  await expectInlinePlayerUnder(page, FIRST_TOP);
  await expectStartOnOpenEmbed(page);
  await expectFeedStillVisible(page);
});

test("should close the player and leave the feed intact", async ({ page }) => {
  await openFeedDemo(page);
  await waitForScoredFeed(page);
  await clickFirstVideoInTier(page, "top");
  await expectInlinePlayerOpen(page);

  await closeInlinePlayer(page);

  await expectNoInlinePlayer(page);
  await expectFeedStillVisible(page);
});

test("should play exactly one video at a time", async ({ page }) => {
  await openFeedDemo(page);
  await waitForScoredFeed(page);

  await clickVideoCard(page, FIRST_TOP);
  await expectInlinePlayerUnder(page, FIRST_TOP);
  await clickVideoCard(page, SECOND_TOP);

  await expectSinglePlayerOpen(page);
  await expectInlinePlayerUnder(page, SECOND_TOP);
});

test("should keep the open player alive when the video is voted on", async ({ page }) => {
  await openFeedDemo(page);
  await waitForScoredFeed(page);
  await clickVideoCard(page, FIRST_TOP);
  await expectInlinePlayerUnder(page, FIRST_TOP);
  await stampPlayerFrame(page);

  // A downvote re-buckets the video to Winnowed. Moving the card would
  // re-parent the iframe and restart playback, so the feed holds still.
  await voteOnVideo(page, FIRST_TOP, "down");

  await expectPlayerFrameSurvived(page);
  await expectInlinePlayerUnder(page, FIRST_TOP);
});

test("should keep a watched video in place while its player is open", async ({ page }) => {
  await openFeedDemo(page);
  await waitForScoredFeed(page);

  await clickVideoCard(page, FIRST_TOP);
  await expectInlinePlayerOpen(page);

  // Opening marks it watched, which normally sinks it to the tier's tail.
  await expectFirstVideoInTier(page, "top", FIRST_TOP);
  await expectFirstVideoInTier(page, "top", "✓");

  await closeInlinePlayer(page);

  // Closing releases the hold — the sink lands then, as feedback.
  await expectLastVideoInTier(page, "top", FIRST_TOP);
});

test("should open the accordion for a deep-linked video", async ({ page }) => {
  await openFeedDemoAtWatch(page, FIRST_TOP_ID);
  await waitForScoredFeed(page);

  await expectInlinePlayerUnder(page, FIRST_TOP);
});

test("should still play a deep-linked video that is not in the feed", async ({ page }) => {
  // Bookmarks and the extension test tier both deep-link ids that aged out
  // of the 300-video window; those must still get a player.
  await openFeedDemoAtWatch(page, "jNQXAC9IVRw");

  await expectInlinePlayerOpen(page);
  await expectStartOnOpenEmbed(page);
});
