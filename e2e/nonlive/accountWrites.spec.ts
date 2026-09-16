import { test } from "@playwright/test";
import {
  expectAccountWrites,
  expectEmbedHost,
  openSettingsDemo,
  openWatchPageDemo,
  setAccountWrites,
} from "../helpers";

// The read-only promise is the default; dropping it is an explicit opt-in
// whose first effect is the signed-in player (plays reach watch history).
const VIDEO_ID = "abc123DEF45";

test("should play in the privacy-enhanced player while Winnow is read-only", async ({ page }) => {
  await openSettingsDemo(page);
  await expectAccountWrites(page, false);

  await openWatchPageDemo(page, VIDEO_ID);
  await expectEmbedHost(page, "www.youtube-nocookie.com");
});

test("should play in the signed-in youtube.com player once account writes are allowed", async ({ page }) => {
  await openSettingsDemo(page);
  await setAccountWrites(page, true);

  await openWatchPageDemo(page, VIDEO_ID);
  await expectEmbedHost(page, "www.youtube.com");

  await openSettingsDemo(page);
  await expectAccountWrites(page, true);
});

test("should return to the privacy-enhanced player when account writes are turned back off", async ({ page }) => {
  await openSettingsDemo(page);
  await setAccountWrites(page, true);
  await setAccountWrites(page, false);

  await openWatchPageDemo(page, VIDEO_ID);
  await expectEmbedHost(page, "www.youtube-nocookie.com");
});
