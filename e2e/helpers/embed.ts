// Watch-page embed helpers. The YouTube player renders inside a cross-origin
// iframe, so assertions go through frameLocator.
import { expect, type FrameLocator, type Page } from "@playwright/test";

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

export async function expectEmbedPlayable(page: Page): Promise<void> {
  await expect(embedFrame(page).getByRole("button", { name: "Play video" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(embedFrame(page).getByText("Video player configuration error")).toBeHidden();
}

export async function expectEmbedConfigurationError(page: Page): Promise<void> {
  await expect(embedFrame(page).getByText("Video player configuration error")).toBeVisible({
    timeout: 30_000,
  });
}
