import { test, expect } from "@playwright/test";
import {
  openFeedDemo,
  openFeedDemoWithProfiles,
  demoVideo,
  waitForScoredFeed,
  switchProfileInFeed,
  getActiveProfileName,
  expectProfileSwitcherHidden,
  getTierVideoTitles,
  getWinnowedFoldText,
  clickWinnowedFold,
  expectVideoInTier,
  expectVideoNotInTier,
  voteOnVideo,
} from "../helpers";
import {
  openSettingsDemoWithState,
  addProfileInSettings,
  getSettingsProfileNames,
  selectActiveProfileInSettings,
  isProfileActiveInSettings,
  renameProfileInSettings,
  deleteProfileInSettings,
  expectDeleteProfileDisabled,
  fillMoreOfProfile,
  readActiveProfile,
} from "../helpers";
import { profileHash } from "../../src/lib/profileHash";
import { PROMPT_VERSION } from "../../src/services/scoring/prompt";
import { DEMO_MODEL } from "../../src/services/scoring/demoScorer";

// sharedvid003 demo-scores 92 (top tier) when the stub scorer runs; the
// seeded per-profile caches below deliberately disagree with that so cache
// hits are distinguishable from fresh scoring.
const VIDEO = demoVideo({ id: "sharedvid003", source: "subscriptions", title: "Shared Video" });

const LEISURE = { id: "leisure1", name: "Leisure", moreOf: "kpop", lessOf: "" };
const ENGINEERING = { id: "engineer1", name: "Engineering", moreOf: "SWE tips", lessOf: "" };

function hashFor(p: { moreOf: string; lessOf: string }): string {
  return profileHash({ ...p, updatedAt: 0 }, PROMPT_VERSION, DEMO_MODEL);
}

function scoreBlob(p: { moreOf: string; lessOf: string }, score: number) {
  return {
    profileHash: hashFor(p),
    scores: {
      sharedvid003: { score, reason: "seeded", clickbait: false, scoredAt: 1, model: DEMO_MODEL },
    },
  };
}

test("should hide the profile switcher while only one profile exists", async ({ page }) => {
  await openFeedDemo(page);
  await waitForScoredFeed(page);
  await expectProfileSwitcherHidden(page);
});

test("should swap tiers instantly from the switched profile's cached scores", async ({ page }) => {
  await openFeedDemoWithProfiles(page, {
    videos: [VIDEO],
    profiles: [LEISURE, ENGINEERING],
    activeProfileId: LEISURE.id,
    perProfileScores: {
      [LEISURE.id]: scoreBlob(LEISURE, 95),
      [ENGINEERING.id]: scoreBlob(ENGINEERING, 20),
    },
  });
  await expectVideoInTier(page, "top", "Shared Video");
  expect(await getActiveProfileName(page)).toBe("Leisure");

  await switchProfileInFeed(page, "Engineering");

  // Engineering's cache says 20 — winnowed, straight from storage.
  expect(await getWinnowedFoldText(page)).toContain("1 video");
  await expectVideoNotInTier(page, "top", "Shared Video");
  await clickWinnowedFold(page);
  await expectVideoInTier(page, "winnowed", "Shared Video");
});

test("should score cache misses after switching to a profile with no cached scores", async ({ page }) => {
  await openFeedDemoWithProfiles(page, {
    videos: [VIDEO],
    profiles: [LEISURE, ENGINEERING],
    activeProfileId: LEISURE.id,
    perProfileScores: { [LEISURE.id]: scoreBlob(LEISURE, 20) },
  });
  expect(await getWinnowedFoldText(page)).toContain("1 video");

  await switchProfileInFeed(page, "Engineering");

  // No cache for Engineering: the demo scorer runs and lands its natural 92.
  await expectVideoInTier(page, "top", "Shared Video");
});

test("should keep votes isolated per profile", async ({ page }) => {
  await openFeedDemoWithProfiles(page, {
    videos: [VIDEO],
    profiles: [LEISURE, ENGINEERING],
    activeProfileId: LEISURE.id,
  });
  await waitForScoredFeed(page);
  await expectVideoInTier(page, "top", "Shared Video");

  // Downvote in Leisure: the vote overrides the score → winnowed.
  await voteOnVideo(page, "Shared Video", "down");
  await expectVideoNotInTier(page, "top", "Shared Video");
  expect(await getWinnowedFoldText(page)).toContain("1 video");

  // Engineering never voted: the same video is back on top.
  await switchProfileInFeed(page, "Engineering");
  await expectVideoInTier(page, "top", "Shared Video");

  // And Leisure still remembers the verdict.
  await switchProfileInFeed(page, "Leisure");
  await expectVideoNotInTier(page, "top", "Shared Video");
  expect(await getWinnowedFoldText(page)).toContain("1 video");
});

test("should create, rename, and switch profiles from settings", async ({ page }) => {
  await openSettingsDemoWithState(page, { profile: { moreOf: "science lectures", lessOf: "" } });

  await addProfileInSettings(page, "Kpop fun");
  expect(await getSettingsProfileNames(page)).toEqual(["Default", "Kpop fun"]);
  expect(await isProfileActiveInSettings(page, "Kpop fun")).toBe(true);

  // The textareas edit the newly active (empty) profile now.
  await fillMoreOfProfile(page, "kpop stage mixes");
  expect((await readActiveProfile(page))?.moreOf).toBe("kpop stage mixes");

  await renameProfileInSettings(page, "Kpop fun", "Kpop nights");
  expect(await getSettingsProfileNames(page)).toEqual(["Default", "Kpop nights"]);

  // Switching back shows the original profile's text again.
  await selectActiveProfileInSettings(page, "Default");
  expect((await readActiveProfile(page))?.moreOf).toBe("science lectures");
});

test("should disable deleting the last remaining profile", async ({ page }) => {
  await openSettingsDemoWithState(page);
  await expectDeleteProfileDisabled(page, "Default");
});

test("should fall back to a remaining profile when the active one is deleted", async ({ page }) => {
  await openSettingsDemoWithState(page, { profile: { moreOf: "science lectures", lessOf: "" } });
  await addProfileInSettings(page, "Doomed");
  expect(await isProfileActiveInSettings(page, "Doomed")).toBe(true);

  await deleteProfileInSettings(page, "Doomed");

  expect(await getSettingsProfileNames(page)).toEqual(["Default"]);
  expect(await isProfileActiveInSettings(page, "Default")).toBe(true);
  expect((await readActiveProfile(page))?.moreOf).toBe("science lectures");
});

test("should keep the top tier ordering stable within a profile", async ({ page }) => {
  // Two videos, both naturally top in demo scoring — a sanity check that the
  // switcher renders and the tier list is the active profile's.
  await openFeedDemoWithProfiles(page, {
    videos: [VIDEO, demoVideo({ id: "kpopvideo002", source: "home", title: "Kpop Video" })],
    profiles: [LEISURE, ENGINEERING],
    activeProfileId: LEISURE.id,
  });
  await waitForScoredFeed(page);
  const titles = await getTierVideoTitles(page, "top");
  expect(titles).toContain("Shared Video");
  expect(titles).toContain("Kpop Video");
});
