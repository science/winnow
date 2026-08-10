import { test, expect } from "@playwright/test";
import {
  clickStartFromBeginning,
  clickVideoCard,
  demoVideo,
  expectNoResumeNotice,
  expectNoResumeOffset,
  expectResumeOffset,
  getResumeNoticeText,
  openFeedDemoWithPositions,
  waitForScoredFeed,
} from "../helpers";

// The nocookie embed is cookie-less, so YouTube can never resume for us —
// the position is Winnow's, and these tests cover the plumbing that carries
// it back into the player. (Capturing positions from a live player is the
// extension tier's job; demo mode has no real player.)
const PARTLY_WATCHED = "Partly Watched Talk";
const BARELY_STARTED = "Barely Started Talk";
const FINISHED = "Finished Talk";

// All three ids score into Top picks under the demo stub, so every card is
// visible without opening a fold.
const VIDEOS = [
  demoVideo({ id: "abc123DEF45", source: "subscriptions", title: PARTLY_WATCHED }),
  demoVideo({ id: "resumevid002", source: "subscriptions", title: BARELY_STARTED }),
  demoVideo({ id: "ghi789JKL01", source: "subscriptions", title: FINISHED }),
];

const POSITIONS = {
  abc123DEF45: { positionSec: 754.6, durationSec: 3600, updatedAt: 1 },
  resumevid002: { positionSec: 8, durationSec: 3600, updatedAt: 2 },
  ghi789JKL01: { positionSec: 3595, durationSec: 3600, updatedAt: 3 },
};

test("should resume a partly-watched video where it left off", async ({ page }) => {
  await openFeedDemoWithPositions(page, VIDEOS, POSITIONS);
  await waitForScoredFeed(page);

  await clickVideoCard(page, PARTLY_WATCHED);

  await expectResumeOffset(page, 754);
});

test("should say where it is resuming from", async ({ page }) => {
  await openFeedDemoWithPositions(page, VIDEOS, POSITIONS);
  await waitForScoredFeed(page);

  await clickVideoCard(page, PARTLY_WATCHED);

  expect(await getResumeNoticeText(page)).toContain("12:34");
});

test("should start from the beginning on request", async ({ page }) => {
  await openFeedDemoWithPositions(page, VIDEOS, POSITIONS);
  await waitForScoredFeed(page);
  await clickVideoCard(page, PARTLY_WATCHED);
  await expectResumeOffset(page, 754);

  await clickStartFromBeginning(page);

  await expectNoResumeOffset(page);
  await expectNoResumeNotice(page);
});

test("should not resume a video the user barely started", async ({ page }) => {
  await openFeedDemoWithPositions(page, VIDEOS, POSITIONS);
  await waitForScoredFeed(page);

  await clickVideoCard(page, BARELY_STARTED);

  await expectNoResumeOffset(page);
  await expectNoResumeNotice(page);
});

test("should not resume a video that was already finished", async ({ page }) => {
  await openFeedDemoWithPositions(page, VIDEOS, POSITIONS);
  await waitForScoredFeed(page);

  await clickVideoCard(page, FINISHED);

  await expectNoResumeOffset(page);
  await expectNoResumeNotice(page);
});
