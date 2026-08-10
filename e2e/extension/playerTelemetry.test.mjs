// Extension-tier gate: Winnow reads the YouTube player's own clock from a
// genuine moz-extension:// origin, using only enablejsapi + postMessage (no
// new permissions, no content script, no script load). This is the seam
// per-video resume positions are built on.
//
// The DNR rule matches ANY sub_frame to the nocookie embed path, so a
// hand-built iframe gets the Referer too — which is why this test needs no
// src/ code at all to prove the seam.
//
// Swept 2026-08-09 against three `origin` param candidates. Only the page's
// own origin works, and the result is not close:
//   moz-extension://<uuid>   → 51 messages, 41 infoDelivery samples ✓
//   https://winnow.misuse.org → 0 messages (the DNR Referer value is NOT it)
//   omitted                   → 0 messages
// So the origin must be read at runtime (location.origin) — the extension
// UUID is random per profile and cannot be a constant.
//
// Autoplay is forced (media.autoplay.default: 0): a player paused at 0.0
// looks exactly like broken telemetry, so the assertion is that currentTime
// INCREASES, never merely that it is non-zero.
//
// Run: npm run test:e2e:ext  (manual tier, live network to YouTube)
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { By, until } from "selenium-webdriver";
import { buildDriver, openExtensionPage } from "./driver.mjs";

const VIDEO_ID = "jNQXAC9IVRw"; // "Me at the zoo" — stable, embeddable
// The round-trip needs a video longer than FINISHED_TAIL_SEC*2: "Me at the
// zoo" is 19s, so it counts as finished (and its position is deliberately
// dropped) within 4s of playing.
const LONG_VIDEO_ID = "dQw4w9WgXcQ"; // 3:33, stable, embeddable
const PLAYBACK_KEY = "winnow:playback:v1";
const PLAYER_ORIGIN = "https://www.youtube-nocookie.com";
const COLLECT_MS = 12_000;

/** Build an embed in the page, post the listening handshake, and collect
 * whatever the player posts back. Runs in page context. */
const PROBE = `
const [videoId, playerOrigin, ms, callback] = arguments;
const src = "https://www.youtube-nocookie.com/embed/" + videoId +
  "?autoplay=1&rel=0&modestbranding=1&enablejsapi=1&origin=" +
  encodeURIComponent(location.origin);
const iframe = document.createElement("iframe");
iframe.src = src;
iframe.allow = "autoplay; encrypted-media";
iframe.width = 640;
iframe.height = 360;
document.body.appendChild(iframe);

const events = [];
const onMessage = (e) => {
  if (e.source !== iframe.contentWindow) return;
  const raw = typeof e.data === "string" ? e.data : JSON.stringify(e.data);
  events.push({ origin: e.origin, raw: String(raw).slice(0, 4000) });
};
window.addEventListener("message", onMessage);

const handshake = () => {
  try {
    iframe.contentWindow.postMessage(
      JSON.stringify({ event: "listening", id: 1, channel: "widget" }),
      playerOrigin,
    );
  } catch (err) { /* frame not ready yet */ }
};
iframe.addEventListener("load", handshake);
const timer = setInterval(handshake, 500);

setTimeout(() => {
  clearInterval(timer);
  window.removeEventListener("message", onMessage);
  iframe.remove();
  callback({ src, events });
}, ms);
`;

function parseSamples(events) {
  const samples = [];
  for (const { origin, raw } of events) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    if (data?.event !== "infoDelivery") continue;
    const info = data.info ?? {};
    if (typeof info.currentTime !== "number") continue;
    samples.push({ origin, currentTime: info.currentTime, duration: info.duration });
  }
  return samples;
}

test("the player reports an advancing clock to a moz-extension page", async () => {
  const driver = await buildDriver({ "media.autoplay.default": 0 });
  await driver.manage().setTimeouts({ script: 60_000 });
  try {
    await openExtensionPage(driver, "feed.html?demo=1");
    const { events } = await driver.executeAsyncScript(
      PROBE,
      VIDEO_ID,
      PLAYER_ORIGIN,
      COLLECT_MS,
    );
    const samples = parseSamples(events);

    assert.ok(
      samples.length >= 2,
      `expected infoDelivery samples, got ${samples.length} from ${events.length} messages`,
    );
    assert.ok(
      samples[samples.length - 1].currentTime > samples[0].currentTime,
      `currentTime never advanced (${samples[0].currentTime} → ${samples[samples.length - 1].currentTime}) — the player may be paused, not silent`,
    );
    const withDuration = samples.find((s) => typeof s.duration === "number" && s.duration > 0);
    assert.ok(withDuration, "no sample carried a positive duration");

    // Production hard-filters on event.origin, so every sample must carry the
    // player's own origin — never an arbitrary sender's.
    for (const s of samples) {
      assert.equal(s.origin, PLAYER_ORIGIN, `unexpected message origin ${s.origin}`);
    }
  } finally {
    await driver.quit();
  }
});

/** Read a key out of the extension's real browser.storage.local. */
const READ_STORAGE = `
const [key, callback] = arguments;
browser.storage.local.get(key).then((r) => callback(r[key] ?? null), () => callback(null));
`;

test("a played video's position round-trips through storage and back into the player", async () => {
  const driver = await buildDriver({ "media.autoplay.default": 0 });
  await driver.manage().setTimeouts({ script: 60_000 });
  try {
    await openExtensionPage(driver, `feed.html?demo=1#/watch/${LONG_VIDEO_ID}`);
    await driver.wait(until.elementLocated(By.css("[data-testid='watch-embed']")), 15_000);

    // Let it play past the throttle's first write.
    await driver.sleep(12_000);
    const first = await driver.executeAsyncScript(READ_STORAGE, PLAYBACK_KEY);
    assert.ok(first?.[LONG_VIDEO_ID], `no position recorded: ${JSON.stringify(first)}`);
    assert.ok(
      first[LONG_VIDEO_ID].positionSec > 0,
      `expected a positive position, got ${first[LONG_VIDEO_ID].positionSec}`,
    );
    assert.ok(
      first[LONG_VIDEO_ID].durationSec > 0,
      `expected a positive duration, got ${first[LONG_VIDEO_ID].durationSec}`,
    );

    // Proves the telemetry keeps flowing (and the throttle keeps writing)
    // well past the first sample — the failure mode this caught once already.
    await driver.sleep(8_000);
    const second = await driver.executeAsyncScript(READ_STORAGE, PLAYBACK_KEY);
    assert.ok(
      second[LONG_VIDEO_ID].positionSec > first[LONG_VIDEO_ID].positionSec,
      `position never advanced (${first[LONG_VIDEO_ID].positionSec} → ${second[LONG_VIDEO_ID].positionSec})`,
    );

    // Close, reopen, and the player must come back at the stored offset.
    await driver.findElement(By.css("[data-testid='close-player']")).click();
    await driver.executeScript(`location.hash = arguments[0];`, `#/watch/${LONG_VIDEO_ID}`);
    await driver.wait(until.elementLocated(By.css("[data-testid='watch-embed']")), 15_000);
    const src = await driver.wait(async () => {
      const el = await driver.findElement(By.css("[data-testid='watch-embed']"));
      const value = await el.getAttribute("src");
      return value?.includes("start=") ? value : null;
    }, 10_000, "the reopened player never carried a resume offset");

    // The offset can only be NEWER than the sample above — playback kept
    // running until the close flushed the final position.
    const start = Number(new URL(src).searchParams.get("start"));
    const { positionSec, durationSec } = second[LONG_VIDEO_ID];
    assert.ok(
      start >= Math.floor(positionSec) && start < durationSec,
      `resume offset ${start} is not a sane continuation of ${positionSec} (duration ${durationSec})`,
    );
  } finally {
    await driver.quit();
  }
});
