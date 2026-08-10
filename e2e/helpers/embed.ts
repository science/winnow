// Watch-page embed helpers. The YouTube player renders inside a cross-origin
// iframe, so assertions go through frameLocator.
import { expect, type FrameLocator, type Page } from "@playwright/test";
import type { Video } from "../../src/lib/types";
import type { PlaybackPosition } from "../../src/lib/playbackPosition";

function embedFrame(page: Page): FrameLocator {
  return page.frameLocator("[data-testid='watch-embed']");
}

export async function openWatchPageDemo(page: Page, videoId: string): Promise<void> {
  await page.goto(`/feed.html?demo=1#/watch/${videoId}`);
}

/** Force the Referer header on the embed document request (null strips it) —
 *  emulates the moz-extension:// context (no referrer) and the DNR fix.
 *  Browsers own the Referer of iframe navigations, so route.continue header
 *  overrides are silently ignored; fetching Node-side and fulfilling is the
 *  only interception that actually controls the header YouTube sees. */
export async function setEmbedReferer(page: Page, referer: string | null): Promise<void> {
  await page.route("**/embed/**", async (route) => {
    const headers = { ...route.request().headers() };
    delete headers["referer"];
    if (referer !== null) headers["referer"] = referer;
    const response = await route.fetch({ headers });
    await route.fulfill({ response });
  });
}

/** "Playable" = the player committed to a working state: either it is already
 *  playing (start-on-open succeeded; Play flips to Pause) or it shows the
 *  Play button (the browser's autoplay policy blocked the start — acceptable
 *  degrade). Either way the error screen must be absent. */
export async function expectEmbedPlayable(page: Page): Promise<void> {
  await expect(
    embedFrame(page)
      .getByRole("button", { name: "Play video" })
      .or(embedFrame(page).getByRole("button", { name: /^Pause/ })),
  ).toBeVisible({ timeout: 30_000 });
  await expect(embedFrame(page).getByText("Video player configuration error")).toBeHidden();
}

// --- resume points ----------------------------------------------------------

/** Seed the feed AND stored playback positions, then open demo mode. */
export async function openFeedDemoWithPositions(
  page: Page,
  videos: Video[],
  positions: Record<string, PlaybackPosition>,
): Promise<void> {
  await page.addInitScript(
    (state) => {
      // Seed once — see openFeedDemoWithSeed.
      if (localStorage.getItem("winnow:e2e-seeded")) return;
      localStorage.clear();
      localStorage.setItem("winnow:e2e-seeded", "1");
      localStorage.setItem("winnow:videos:v1", JSON.stringify(state.videos));
      localStorage.setItem("winnow:playback:v1", JSON.stringify(state.positions));
    },
    { videos: { fetchedAt: Date.now(), videos }, positions },
  );
  await page.goto("/feed.html?demo=1");
}

export async function getEmbedSrc(page: Page): Promise<string> {
  return (await page.getByTestId("watch-embed").getAttribute("src")) ?? "";
}

export async function expectResumeOffset(page: Page, sec: number): Promise<void> {
  await expect(page.getByTestId("watch-embed")).toHaveAttribute("src", new RegExp(`[?&]start=${sec}(&|$)`));
}

export async function expectNoResumeOffset(page: Page): Promise<void> {
  await expect(page.getByTestId("watch-embed")).not.toHaveAttribute("src", /[?&]start=/);
}

export async function getResumeNoticeText(page: Page): Promise<string> {
  return page.getByTestId("resume-notice").innerText();
}

export async function expectNoResumeNotice(page: Page): Promise<void> {
  await expect(page.getByTestId("resume-notice")).toHaveCount(0);
}

export async function clickStartFromBeginning(page: Page): Promise<void> {
  await page.getByTestId("restart-video").click();
}

export async function expectEmbedConfigurationError(page: Page): Promise<void> {
  await expect(embedFrame(page).getByText("Video player configuration error")).toBeVisible({
    timeout: 30_000,
  });
}
