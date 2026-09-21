// Android-only gate for fullscreen. Winnow's open player IS the URL hash
// (#/watch/<id>), and on a phone Back is how people leave fullscreen — so
// Back must exit fullscreen without also closing (or reloading) the player.
//
// Run: npm run test:e2e:android  (emulator or phone; docs/DEVELOPMENT.md, Android tier)
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { By, until } from "selenium-webdriver";
import { ANDROID, buildDriver, openExtensionPage } from "../extension/driver.mjs";
import { pressBack } from "./ui.mjs";

const VIDEO_ID = "aqz-KE-bpKQ"; // Big Buck Bunny
const EMBED = By.css("[data-testid='watch-embed']");

const PAGE_STATE = `
const frame = document.querySelector("[data-testid='watch-embed']");
return {
  fullscreen: document.fullscreenElement === frame && frame !== null,
  hash: location.hash,
  stamp: frame?.dataset.stamp ?? null,
};`;

const VIEWPORT = "return `${innerWidth}x${innerHeight}`;";

/** Resolves once the viewport has kept one size for 1.5 s. */
async function screenSettled(driver) {
  let last = "";
  let since = Date.now();
  await driver.wait(async () => {
    const now = await driver.executeScript(VIEWPORT);
    if (now !== last) {
      last = now;
      since = Date.now();
    }
    return Date.now() - since >= 1_500;
  }, 20_000, "the screen never stopped rotating");
}

/** The mobile player hides its controls; a tap on the video reveals them.
 * The embed replaces its bootstrap document while loading, which detaches
 * the frame context mid-poll, and driver.wait aborts on a thrown error — so
 * re-enter the frame every poll and treat any WebDriver error as "not yet"
 * (same pattern as extension/watchEmbed.test.mjs). */
async function enterFullscreen(driver) {
  try {
    await driver.wait(async () => {
      try {
        await driver.switchTo().defaultContent();
        await driver.switchTo().frame(await driver.findElement(EMBED));
        const video = await driver.findElement(By.css("video"));
        await driver.actions({ async: true }).move({ origin: video }).press().release().perform();
        await driver.sleep(400);
        await driver.findElement(By.css("button[aria-label='Enter full screen']")).click();
        return true;
      } catch {
        return false;
      }
    }, 30_000, "the fullscreen control never became pressable");
  } finally {
    await driver.switchTo().defaultContent();
  }
}

test("Back leaves fullscreen and keeps the same player open", { skip: !ANDROID }, async () => {
  const driver = await buildDriver({ "media.autoplay.default": 0 });
  try {
    await openExtensionPage(driver, `feed.html?demo=1#/watch/${VIDEO_ID}`);
    const iframe = await driver.wait(until.elementLocated(EMBED), 15_000);
    // Moving or re-creating an <iframe> reloads it; the stamp proves neither happened.
    await driver.executeScript("arguments[0].dataset.stamp = 'same-frame';", iframe);

    await enterFullscreen(driver);
    await driver.wait(async () => (await driver.executeScript(PAGE_STATE)).fullscreen, 15_000, "never entered fullscreen");
    // Firefox turns the screen for a fullscreen video, and a Back pressed
    // mid-turn is swallowed. Which way it ends up is Firefox's business and
    // depends on how the phone is lying: on a rotation-locked Pixel 8 flat on
    // a desk it turned to landscape and straight back within 120 ms in about
    // half the runs (2026-09-21, Firefox 157.0b4). So wait for the screen to
    // stop moving, not for a particular orientation.
    await screenSettled(driver);

    pressBack();
    await driver.wait(async () => !(await driver.executeScript(PAGE_STATE)).fullscreen, 10_000, "Back did not leave fullscreen");
    await screenSettled(driver);
    assert.deepEqual(await driver.executeScript(PAGE_STATE), {
      fullscreen: false,
      hash: `#/watch/${VIDEO_ID}`,
      stamp: "same-frame",
    });
  } finally {
    await driver.quit();
  }
});
