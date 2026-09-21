// Extension-tier e2e: installs the built zip into REAL Firefox (headless,
// via geckodriver) and verifies the watch-page player from a genuine
// moz-extension:// origin — the only context that reproduces YouTube's
// error 153 (Firefox sends no Referer from extension pages; see
// docs/DEVELOPMENT.md, error-153 invariant). Playwright cannot load Firefox
// extensions, hence selenium here. Live network to youtube-nocookie.com.
//
// Three runs, because autoplay policy is a profile-level pref:
//  1. default prefs, deep link — no user gesture, so Firefox blocks audible
//     autoplay and start-on-open degrades to a visible Play button (never
//     the error screen);
//  2. autoplay allowed — the deterministic proof that autoplay=1 +
//     allow="autoplay" actually start playback;
//  3. default prefs, a TAPPED card — what a user actually does. The tap's
//     user activation reaches the player, so the video starts, unmuted, with
//     no setting changed (measured 2026-09-21 on desktop 155 and Firefox for
//     Android 156). This is the product promise; 1 and 2 bracket it.
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

async function openByDeepLink(driver) {
  await openExtensionPage(driver, `feed.html?demo=1#/watch/${VIDEO_ID}`);
}

/** The demo feed's fixture ids are fake; seed one real video and tap its
 * card. A WebDriver click is a trusted input event, like a finger. */
async function openByTappingCard(driver) {
  await openExtensionPage(driver, "feed.html?demo=1");
  await driver.executeScript(
    `localStorage.clear();
     localStorage.setItem("winnow:videos:v1", JSON.stringify({ fetchedAt: Date.now(), videos: [arguments[0]] }));
     location.reload();`,
    {
      id: VIDEO_ID, source: "subscriptions", title: "Me at the zoo", channelTitle: "jawed",
      channelId: null, durationText: "0:19", durationSec: 19, publishedText: "20 years ago",
      publishedAtApprox: null, viewCountText: null, viewCount: null, thumbnailUrl: null,
      descriptionSnippet: null, isLive: false,
    },
  );
  const card = await driver.wait(
    until.elementLocated(By.css(`[data-testid='video-card'][href$='${VIDEO_ID}']`)),
    30_000,
    "the seeded video never showed up as a card",
  );
  await card.click();
}

async function waitForPlayerOutcome(driver, open = openByDeepLink) {
  await open(driver);
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

test("default prefs: a tapped card starts playing, with no setting changed", async () => {
  const driver = await buildDriver();
  try {
    const outcome = await waitForPlayerOutcome(driver, openByTappingCard);
    assert.equal(
      outcome.state,
      "playing",
      `expected the tapped video to start, got "${outcome.state}":\n${outcome.body}`,
    );
  } finally {
    await driver.quit();
  }
});
