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
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { Builder, By, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";

const ROOT = resolve(import.meta.dirname, "../..");
const ZIP = process.env["WINNOW_ZIP"] ?? resolve(ROOT, "web-ext-artifacts/winnow-0.1.0.zip");
// Pre-seeded so the extension-page URL is deterministic (Firefox otherwise
// assigns a random per-profile UUID).
const UUID = "d3adbeef-0000-4000-8000-000000000001";
const VIDEO_ID = "jNQXAC9IVRw"; // "Me at the zoo" — stable, embeddable

async function buildDriver(extraPrefs = {}) {
  assert.ok(existsSync(ZIP), `${ZIP} missing — run \`npm run zip\` first`);
  const options = new firefox.Options()
    .addArguments("-headless")
    .setPreference(
      "extensions.webextensions.uuids",
      JSON.stringify({ "winnow@misuse.org": UUID }),
    );
  for (const [k, v] of Object.entries(extraPrefs)) options.setPreference(k, v);
  const builder = new Builder().forBrowser("firefox").setFirefoxOptions(options);
  if (existsSync("/snap/bin/geckodriver")) {
    builder.setFirefoxService(new firefox.ServiceBuilder("/snap/bin/geckodriver"));
  }
  const driver = await builder.build();
  await driver.installAddon(ZIP, true);
  return driver;
}

// Poll until the player commits: the error screen, an already-playing player
// (start-on-open; Play flips to Pause), or the Play button (autoplay blocked
// by policy). The embed replaces its bootstrap document while loading, which
// detaches the frame context mid-poll; driver.wait aborts on a thrown error
// (it only retries falsy returns), so re-enter the frame every poll and map
// any WebDriver error to "not ready yet".
async function waitForPlayerOutcome(driver) {
  await driver.get(`moz-extension://${UUID}/feed.html?demo=1#/watch/${VIDEO_ID}`);
  await driver.wait(until.elementLocated(By.css("[data-testid='watch-embed']")), 15_000);
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
      if (play.length > 0) return { state: "blocked-but-playable", body };
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
