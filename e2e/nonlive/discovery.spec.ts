import { test, expect } from "@playwright/test";
import {
  openFeedDemoWithProfiles,
  demoVideo,
  waitForScoredFeed,
  switchProfileInFeed,
  clickGoDeeper,
  getDiscoveryVideoTitles,
  waitForDiscoveryResults,
  expectDiscoveryEmpty,
  clickDiscoveryWinnowedFold,
  getDiscoveryWinnowedTitles,
  expectDiscoveryTitleHidden,
  getDiscoveryStatusText,
} from "../helpers";

// Demo discovery is fully deterministic: the query pool comes from the
// profile's comma-separated moreOf phrases ("<phrase> deep dive"), each
// query yields 8 synthetic results (the 8th never scores — unvet id), and
// the demo scorer tiers them by id hash. Ten phrases → run 1 uses queries
// 1-5 (LRU), run 2 uses 6-10.
const TEN_PHRASES = "alpha, beta, gamma, delta, epsilon, zeta, eta, theta, iota, kappa";

const LEISURE = { id: "leisure1", name: "Leisure", moreOf: TEN_PHRASES, lessOf: "" };
const OTHER = { id: "other0001", name: "Other", moreOf: "something else entirely", lessOf: "" };

function openWithProfiles(page: Parameters<typeof openFeedDemoWithProfiles>[0]) {
  return openFeedDemoWithProfiles(page, {
    videos: [demoVideo({ id: "sharedvid003", source: "subscriptions", title: "Feed Video" })],
    profiles: [LEISURE, OTHER],
    activeProfileId: LEISURE.id,
  });
}

test("should populate the discovery section with scored search results after pressing go deeper", async ({ page }) => {
  await openWithProfiles(page);
  await waitForScoredFeed(page);

  await clickGoDeeper(page);
  await waitForDiscoveryResults(page);

  const titles = await getDiscoveryVideoTitles(page);
  // "alpha deep dive" result 3 demo-scores top tier (precomputed).
  expect(titles).toContain("alpha deep dive — result 3");
  // Low scorers are behind the discovery fold, not in the browsable list.
  expect(titles).not.toContain("alpha deep dive — result 2");
  await clickDiscoveryWinnowedFold(page);
  expect(await getDiscoveryWinnowedTitles(page)).toContain("alpha deep dive — result 2");
});

test("should never surface unscorable discoveries as browsable cards", async ({ page }) => {
  await openWithProfiles(page);
  await waitForScoredFeed(page);

  await clickGoDeeper(page);
  await waitForDiscoveryResults(page);

  // Result 8 of every query has the unvet id prefix — the demo scorer never
  // scores it, so it must stay out of the section entirely.
  await expectDiscoveryTitleHidden(page, "alpha deep dive — result 8");
});

test("should discover different videos on a second press without repeating any", async ({ page }) => {
  await openWithProfiles(page);
  await waitForScoredFeed(page);

  await clickGoDeeper(page);
  await waitForDiscoveryResults(page);
  const firstRun = await getDiscoveryVideoTitles(page);
  expect(firstRun.some((t) => t.startsWith("alpha deep dive"))).toBe(true);
  expect(firstRun.some((t) => t.startsWith("zeta deep dive"))).toBe(false);

  await clickGoDeeper(page);
  // Run 2 rotates to the unused queries (zeta..kappa).
  await expect
    .poll(async () => (await getDiscoveryVideoTitles(page)).some((t) => t.startsWith("zeta deep dive")), {
      timeout: 10_000,
    })
    .toBe(true);

  const secondRun = await getDiscoveryVideoTitles(page);
  // Everything from run 1 is still there exactly once — nothing repeated.
  for (const title of firstRun) {
    expect(secondRun.filter((t) => t === title)).toHaveLength(1);
  }
});

test("should keep discoveries scoped to the profile that ran them", async ({ page }) => {
  await openWithProfiles(page);
  await waitForScoredFeed(page);

  await clickGoDeeper(page);
  await waitForDiscoveryResults(page);

  await switchProfileInFeed(page, "Other");
  await expectDiscoveryEmpty(page);

  await switchProfileInFeed(page, "Leisure");
  await waitForDiscoveryResults(page);
  expect((await getDiscoveryVideoTitles(page)).length).toBeGreaterThan(0);
});

test("should point at regenerating queries when the pool is spent and nothing new turns up", async ({ page }) => {
  await openFeedDemoWithProfiles(page, {
    videos: [demoVideo({ id: "sharedvid003", source: "subscriptions", title: "Feed Video" })],
    // One phrase → a one-query pool: the second press finds only dupes.
    profiles: [{ id: "leisure1", name: "Leisure", moreOf: "alpha", lessOf: "" }, OTHER],
    activeProfileId: "leisure1",
  });
  await waitForScoredFeed(page);

  await clickGoDeeper(page);
  await waitForDiscoveryResults(page);

  await clickGoDeeper(page);
  await expect
    .poll(async () => getDiscoveryStatusText(page).catch(() => ""), { timeout: 10_000 })
    .toMatch(/regenerate/i);
});
