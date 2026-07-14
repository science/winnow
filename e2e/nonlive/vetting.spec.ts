import { test, expect } from "@playwright/test";
import {
  demoVideo,
  openFeedDemoWithSeed,
  expectUnvettedFoldVisible,
  getUnvettedFoldText,
  clickUnvettedFold,
  getUnvettedVideoTitles,
  expectVideoCardHidden,
  expectVideoCardVisible,
  expectRetryScoringHidden,
  expectRetryScoringInsideUnvettedFold,
  expectScoringProgressVisible,
  expectScoringProgressHidden,
  expectFeedBottomMarker,
} from "../helpers";

// The demo scorer never returns scores for ids prefixed "unvet" — that is
// the deterministic seam for exercising the awaiting-vetting fold. `?slow=1`
// delays demo batches so the scoring-progress panel is observable.

const UNVETTED = demoVideo({
  id: "unvetted001",
  source: "home",
  title: "A Video The Scorer Never Vets",
});

// These ids demo-score into visible tiers (fnv1a: niceideas02 → top,
// calmvideo01 → worth a look), so the cards must appear once vetted.
const NORMALS = [
  demoVideo({ id: "niceideas02", source: "subscriptions", title: "A Perfectly Normal Deep Dive" }),
  demoVideo({ id: "calmvideo01", source: "home", title: "Another Ordinary Video" }),
];

test("should keep unvetted videos out of the visible feed behind an awaiting-vetting fold", async ({ page }) => {
  await openFeedDemoWithSeed(page, [...NORMALS, UNVETTED]);

  await expectUnvettedFoldVisible(page);
  expect(await getUnvettedFoldText(page)).toMatch(/1 video awaiting vetting/i);
  await expectVideoCardHidden(page, UNVETTED.title);

  await clickUnvettedFold(page);
  const titles = await getUnvettedVideoTitles(page);
  expect(titles.join(" ")).toContain(UNVETTED.title);

  await expectFeedBottomMarker(page);
});

test("should offer retry scoring inside the awaiting-vetting fold, not in the main feed", async ({ page }) => {
  await openFeedDemoWithSeed(page, [...NORMALS, UNVETTED]);

  await expectUnvettedFoldVisible(page);
  // Folded away: no retry button floating in the main feed.
  await expectRetryScoringHidden(page);

  await clickUnvettedFold(page);
  await expectRetryScoringInsideUnvettedFold(page);
});

test("should show scoring progress instead of unscored cards while a run is active", async ({ page }) => {
  await openFeedDemoWithSeed(page, NORMALS, { slow: true });

  await expectScoringProgressVisible(page);
  // While the run is active, unvetted videos are not browsable cards.
  await expectVideoCardHidden(page, NORMALS[0]!.title);
  await expectVideoCardHidden(page, NORMALS[1]!.title);

  await expectScoringProgressHidden(page);
  // Vetted now — the videos appear in the scored tiers.
  await expectVideoCardVisible(page, NORMALS[0]!.title);
});
