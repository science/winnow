import { test } from "@playwright/test";
import { embedRefererRules } from "../../src/lib/embed";
import {
  expectEmbedConfigurationError,
  expectEmbedHost,
  expectEmbedPlayable,
  openSettingsDemo,
  openWatchPageDemo,
  setAccountWrites,
  setEmbedReferer,
} from "../helpers";

// "Me at the zoo" — the first YouTube video; stable and embeddable.
const VIDEO_ID = "jNQXAC9IVRw";

const RULE_REFERER = embedRefererRules("unused.invalid")[0]!.action.requestHeaders[0]!.value;

// YouTube rejects embed requests that carry no HTTP Referer (player error
// 153). Extension pages never send one, so the runtime DNR rule injects
// RULE_REFERER. Playwright can't load the extension itself; instead these
// tests pin both sides of the contract against real YouTube: the enforcement
// still exists, and the exact value our rule injects is still accepted.
// Live tier: real network to youtube-nocookie.com / youtube.com, no keys.
test.describe("embed Referer contract (error 153)", () => {
  test("should show the player error screen when the embed request has no Referer", async ({ page }) => {
    await setEmbedReferer(page, null);
    await openWatchPageDemo(page, VIDEO_ID);
    await expectEmbedConfigurationError(page);
  });

  test("should reach a playable player with the Referer our DNR rule injects", async ({ page }) => {
    await setEmbedReferer(page, RULE_REFERER);
    await openWatchPageDemo(page, VIDEO_ID);
    await expectEmbedPlayable(page);
  });

  test("should reach a playable signed-in player with the Referer our DNR rule injects", async ({ page }) => {
    await setEmbedReferer(page, RULE_REFERER);
    await openSettingsDemo(page);
    await setAccountWrites(page, true);
    await openWatchPageDemo(page, VIDEO_ID);
    await expectEmbedHost(page, "www.youtube.com");
    await expectEmbedPlayable(page);
  });
});
