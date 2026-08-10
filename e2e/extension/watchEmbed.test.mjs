// Extension-tier e2e: installs the built zip into REAL Firefox (headless,
// via geckodriver) and verifies the watch-page player from a genuine
// moz-extension:// origin — the only context that reproduces YouTube's
// error 153 (Firefox sends no Referer from extension pages; see
// docs/DEVELOPMENT.md, error-153 invariant). Playwright cannot load Firefox
// extensions, hence selenium here. Live network to youtube-nocookie.com.
//
// Two runs, because autoplay policy is a profile-level pref:
//  1. default prefs — Firefox blocks audible autoplay, so start-on-open
//     degrades to a visible Play button (never the error screen);
//  2. autoplay allowed — the deterministic proof that autoplay=1 +
//     allow="autoplay" actually start playback.
//
// Run: npm run test:e2e:ext  (builds + zips first; manual tier, not CI)
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { By, until } from "selenium-webdriver";
import { buildDriver, openExtensionPage } from "./driver.mjs";

const VIDEO_ID = "jNQXAC9IVRw"; // "Me at the zoo" — stable, embeddable

// Poll until the player commits: the error screen, an already-playing player
// (start-on-open; Play flips to Pause), or the Play button (autoplay blocked
// by policy). The embed replaces its bootstrap document while loading, which
// detaches the frame context mid-poll; driver.wait aborts on a thrown error
// (it only retries falsy returns), so re-enter the frame every poll and map
// any WebDriver error to "not ready yet".
// A Play button is only conclusive once it has PERSISTED. YouTube's player
// renders its Play control during startup and swaps to a playing state a
// moment later, so returning on first sight raced autoplay and failed roughly
// one run in five regardless of the build under test (measured 2026-07-31 on
// both 0.2.1 and 0.2.2). Playback and the error screen stay conclusive
// immediately; only the negative verdict has to wait itself out.
const PLAY_BUTTON_SETTLE_MS = 4000;

async function waitForPlayerOutcome(driver) {
  await openExtensionPage(driver, `feed.html?demo=1#/watch/${VIDEO_ID}`);
  await driver.wait(until.elementLocated(By.css("[data-testid='watch-embed']")), 15_000);
  let playSeenAt = null;
  return driver.wait(async () => {
    try {
      await driver.switchTo().defaultContent();
      const iframe = await driver.findElement(By.css("[data-testid='watch-embed']"));
      await driver.switchTo().frame(iframe);
      const body = await driver.findElement(By.css("body")).getText();
      if (body.includes("Video player configuration error") || body.includes("Error 153")) {
        return { state: "error", body };
      }
      const playing = await driver.executeScript(
        "const v = document.querySelector('video'); return !!v && !v.paused && v.currentTime > 0;",
      );
      if (playing) return { state: "playing", body };
      const pause = await driver.findElements(By.css("button[aria-label^='Pause']"));
      if (pause.length > 0) return { state: "playing", body };
      const play = await driver.findElements(By.css("button[aria-label='Play video']"));
      if (play.length > 0) {
        playSeenAt ??= Date.now();
        if (Date.now() - playSeenAt >= PLAY_BUTTON_SETTLE_MS) {
          return { state: "blocked-but-playable", body };
        }
        return null;
      }
      playSeenAt = null;
      return null;
    } catch {
      return null;
    }
  }, 30_000, "player never reached an error, playing, or playable state");
}

test("default prefs: watch page reaches a working player (never error 153)", async () => {
  const driver = await buildDriver();
  try {
    const outcome = await waitForPlayerOutcome(driver);
    assert.notEqual(
      outcome.state,
      "error",
      `expected a working player, got the YouTube error screen:\n${outcome.body}`,
    );
  } finally {
    await driver.quit();
  }
});

test("autoplay allowed: the clicked video starts playing on open", async () => {
  const driver = await buildDriver({ "media.autoplay.default": 0 });
  try {
    const outcome = await waitForPlayerOutcome(driver);
    assert.equal(
      outcome.state,
      "playing",
      `expected start-on-open playback, got "${outcome.state}":\n${outcome.body}`,
    );
  } finally {
    await driver.quit();
  }
});
