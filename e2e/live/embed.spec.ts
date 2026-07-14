import { readFileSync } from "node:fs";
import { test } from "@playwright/test";
import {
  expectEmbedConfigurationError,
  expectEmbedPlayable,
  openWatchPageDemo,
  setEmbedReferer,
} from "../helpers";

// "Me at the zoo" — the first YouTube video; stable and embeddable.
const VIDEO_ID = "jNQXAC9IVRw";

interface DnrRules {
  0: { action: { requestHeaders: { value: string }[] } };
}
const rules = JSON.parse(
  readFileSync(new URL("../../public/dnr-rules.json", import.meta.url), "utf8"),
) as DnrRules;
const RULE_REFERER = rules[0].action.requestHeaders[0]!.value;

// YouTube rejects embed requests that carry no HTTP Referer (player error
// 153). Extension pages never send one, so public/dnr-rules.json injects
// RULE_REFERER. Playwright can't load the extension itself; instead these
// tests pin both sides of the contract against real YouTube: the enforcement
// still exists, and the exact value our rule injects is still accepted.
// Live tier: real network to youtube-nocookie.com, but no provider keys.
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
});
