// Android-only gate for fullscreen. Winnow's open player IS the URL hash
// (#/watch/<id>), and on a phone Back is how people leave fullscreen — so
// Back must exit fullscreen without also closing (or reloading) the player.
//
// Run: npm run test:e2e:android  (emulator; scripts/android-emulator.sh start)
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { By, until } from "selenium-webdriver";
import { ANDROID, buildDriver, openExtensionPage } from "../extension/driver.mjs";
import { pressBack } from "./ui.mjs";

const VIDEO_ID = "dQw4w9WgXcQ";
const EMBED = By.css("[data-testid='watch-embed']");

const PAGE_STATE = `
const frame = document.querySelector("[data-testid='watch-embed']");
return {
  fullscreen: document.fullscreenElement === frame && frame !== null,
  landscape: innerWidth > innerHeight,
  hash: location.hash,
  stamp: frame?.dataset.stamp ?? null,
};`;

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
    // Fullscreen video rotates the screen; Back is only meaningful once the
    // transition has finished, which is also the earliest a person could press it.
    await driver.wait(
      async () => {
        const state = await driver.executeScript(PAGE_STATE);
        return state.fullscreen && state.landscape;
      },
      15_000,
      "never settled into landscape fullscreen",
    );

    pressBack();
    await driver.wait(async () => !(await driver.executeScript(PAGE_STATE)).fullscreen, 10_000, "Back did not leave fullscreen");
    await driver.wait(async () => !(await driver.executeScript(PAGE_STATE)).landscape, 15_000, "never rotated back");
    assert.deepEqual(await driver.executeScript(PAGE_STATE), {
      fullscreen: false,
      landscape: false,
      hash: `#/watch/${VIDEO_ID}`,
      stamp: "same-frame",
    });
  } finally {
    await driver.quit();
  }
});
