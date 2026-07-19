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

/** Seed a full multi-profile world: the profiles collection, the shared
 * video window, and optional per-profile score caches (winnow:scores:v2:<id>).
 * Score blobs must carry the profileHash the app will compute, or they read
 * as stale and re-score. */
export async function openFeedDemoWithProfiles(
  page: Page,
  state: {
    videos: Video[];
    profiles: { id: string; name: string; moreOf?: string; lessOf?: string }[];
    activeProfileId: string;
    perProfileScores?: Record<string, unknown>;
    perProfileFeedback?: Record<string, unknown>;
  },
): Promise<void> {
  await page.addInitScript(
    (s) => {
      localStorage.clear();
      localStorage.setItem(
        "winnow:videos:v1",
        JSON.stringify({ fetchedAt: Date.now(), videos: s.videos }),
      );
      localStorage.setItem(
        "winnow:profiles:v1",
        JSON.stringify({
          activeProfileId: s.activeProfileId,
          profiles: s.profiles.map((p) => ({ moreOf: "demo", lessOf: "", updatedAt: 1, ...p })),
        }),
      );
      for (const [id, blob] of Object.entries(s.perProfileScores ?? {})) {
        localStorage.setItem(`winnow:scores:v2:${id}`, JSON.stringify(blob));
      }
      for (const [id, blob] of Object.entries(s.perProfileFeedback ?? {})) {
        localStorage.setItem(`winnow:feedback:v2:${id}`, JSON.stringify(blob));
      }
    },
    state,
  );
  await page.goto("/feed.html?demo=1");
}

export async function switchProfileInFeed(page: Page, name: string): Promise<void> {
  await page.getByTestId("profile-switcher").selectOption({ label: name });
}

export async function getActiveProfileName(page: Page): Promise<string> {
  return page.getByTestId("profile-switcher").locator("option:checked").innerText();
}

export async function expectProfileSwitcherHidden(page: Page): Promise<void> {
  await expect(page.getByTestId("profile-switcher")).not.toBeVisible();
}

// --- discovery ("go deeper") -----------------------------------------------

export async function clickGoDeeper(page: Page): Promise<void> {
  await page.getByTestId("go-deeper").click();
}

export async function clickRegenerateQueries(page: Page): Promise<void> {
  await page.getByTestId("regenerate-queries").click();
}

/** Titles of browsable (top / worth-a-look) discovery cards. */
export async function getDiscoveryVideoTitles(page: Page): Promise<string[]> {
  return page.getByTestId("discovery-results").getByTestId("video-card").locator("h3").allInnerTexts();
}

export async function waitForDiscoveryResults(page: Page): Promise<void> {
  await expect(
    page.getByTestId("discovery-results").getByTestId("video-card").first(),
  ).toBeVisible({ timeout: 10_000 });
}

export async function expectDiscoveryEmpty(page: Page): Promise<void> {
  await expect(page.getByTestId("discovery").getByTestId("video-card")).toHaveCount(0);
  await expect(page.getByTestId("discovery-winnowed-fold")).not.toBeVisible();
}

export async function getDiscoveryWinnowedFoldText(page: Page): Promise<string> {
  return page.getByTestId("discovery-winnowed-fold").innerText();
}

export async function clickDiscoveryWinnowedFold(page: Page): Promise<void> {
  await page.getByTestId("discovery-winnowed-fold").click();
}

export async function getDiscoveryWinnowedTitles(page: Page): Promise<string[]> {
  return page.getByTestId("discovery-winnowed").getByTestId("video-card").locator("h3").allInnerTexts();
}

/** The named title renders nowhere in the discovery section. */
export async function expectDiscoveryTitleHidden(page: Page, title: string): Promise<void> {
  await expect(
    page.getByTestId("discovery").getByTestId("video-card").filter({ hasText: title }),
  ).toHaveCount(0);
}

export async function getDiscoveryStatusText(page: Page): Promise<string> {
  return page.getByTestId("discovery-status").innerText();
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

function cardByTitle(page: Page, title: string) {
  return page.getByTestId("video-card").filter({ hasText: title });
}

/** Click Good pick / Not for me on the card with this title (the card must
 * be visible — open the relevant fold first). */
export async function voteOnVideo(page: Page, title: string, vote: "up" | "down"): Promise<void> {
  await cardByTitle(page, title).getByTestId(`vote-${vote}`).click();
}

export async function getVotePressedState(page: Page, title: string, vote: "up" | "down"): Promise<boolean> {
  const value = await cardByTitle(page, title).getByTestId(`vote-${vote}`).getAttribute("aria-pressed");
  return value === "true";
}

export async function expectVideoInTier(
  page: Page,
  tier: "top" | "worth" | "winnowed",
  title: string,
): Promise<void> {
  await expect(page.getByTestId(`tier-${tier}`).getByTestId("video-card").filter({ hasText: title })).toBeVisible();
}

export async function expectVideoNotInTier(
  page: Page,
  tier: "top" | "worth" | "winnowed",
  title: string,
): Promise<void> {
  await expect(page.getByTestId(`tier-${tier}`).getByTestId("video-card").filter({ hasText: title })).not.toBeVisible();
}

export async function expectWatchViewForSomeVideo(page: Page): Promise<void> {
  await expect(page.locator("iframe[src*='youtube-nocookie.com/embed/']")).toBeVisible();
}

/** Start-on-open: the clicked video is asked to play immediately (autoplay=1,
 *  unmuted). Autoplay-NEXT remains forbidden — nothing queues after. */
export async function expectStartOnOpenEmbed(page: Page): Promise<void> {
  const src = await page.locator("iframe[src*='youtube-nocookie.com']").getAttribute("src");
  expect(src).toContain("autoplay=1");
  expect(src).not.toContain("mute");
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
