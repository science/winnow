// Extension-tier gate for Winnow's own requests to YouTube, made from a real
// moz-extension:// page with the browser's real user agent. That matters on
// Firefox for Android (WINNOW_TARGET=android): a phone's user agent is
// redirected to m.youtube.com, whose pages carry no `var ytInitialData` blob,
// so every fetch must ask for the desktop page (lib/ytUrl.ts).
//
// The test profile is signed out. That is enough: the signed-out state is
// only reachable when the page was fetched AND parsed — a mobile page fails
// earlier, as a parse error.
//
// Run: npm run test:e2e:ext / npm run test:e2e:android (manual tier, live
// network to YouTube)
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { By, until } from "selenium-webdriver";
import { ANDROID_CLIENT } from "../../src/lib/innertubeClient.ts";
import { desktopPageUrl } from "../../src/lib/ytUrl.ts";
import { buildDriver, openExtensionPage, seedRealConfig } from "./driver.mjs";

const VIDEO_ID = "dQw4w9WgXcQ"; // has human-made English captions

const FETCH_PAGE = `
const [url, callback] = arguments;
fetch(url, { credentials: "include", headers: { "Accept-Language": "en-US,en;q=0.9" } })
  .then(async (res) => {
    const html = await res.text();
    callback({
      finalHost: new URL(res.url).hostname,
      status: res.status,
      hasInitialData: /var ytInitialData\\s*=\\s*\\{/.test(html),
      videoRenderers: (html.match(/"videoRenderer"/g) ?? []).length,
    });
  })
  .catch((e) => callback({ error: String(e) }));
`;

const FETCH_TRANSCRIPT = `
const [videoId, client, callback] = arguments;
(async () => {
  const player = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    credentials: "omit",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ context: { client: { ...client, hl: "en" } }, videoId }),
  });
  if (!player.ok) return { playerStatus: player.status };
  const tracks = (await player.json())?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const track = tracks.find((t) => t.baseUrl);
  if (!track) return { playerStatus: player.status, tracks: tracks.length };
  const timedtext = await fetch(track.baseUrl + "&fmt=json3", { credentials: "omit" });
  return {
    playerStatus: player.status,
    tracks: tracks.length,
    timedtextStatus: timedtext.status,
    timedtextBytes: (await timedtext.text()).length,
  };
})().then(callback, (e) => callback({ error: String(e) }));
`;

test("a signed-out browser reaches the signed-out state, never the parse error", async () => {
  const driver = await buildDriver();
  try {
    await seedRealConfig(driver);
    await openExtensionPage(driver, "feed.html");
    // A feed that can't be fetched or parsed degrades to a warning (or, with
    // nothing at all loaded, the error panel) — the two ways this goes wrong.
    const OUTCOMES = "[data-testid='signed-out'], [data-testid='feed-error'], [data-testid='feed-warning']";
    const outcome = await driver
      .wait(until.elementLocated(By.css(OUTCOMES)), 45_000)
      .catch(async () => {
        const text = await driver.findElement(By.css("body")).getText();
        assert.fail(`the feed never settled into a recognizable state:\n${text}`);
      });
    assert.equal(
      await outcome.getAttribute("data-testid"),
      "signed-out",
      `the feed fetch failed before it could tell who is signed in:\n${await outcome.getText()}`,
    );
  } finally {
    await driver.quit();
  }
});

test("a search page fetched from the extension is the desktop page", async () => {
  const driver = await buildDriver();
  await driver.manage().setTimeouts({ script: 45_000 });
  try {
    await openExtensionPage(driver, "feed.html?demo=1#/settings");
    const page = await driver.executeAsyncScript(
      FETCH_PAGE,
      desktopPageUrl("https://www.youtube.com/results?search_query=rust%20programming"),
    );
    assert.equal(page.error, undefined, page.error);
    assert.equal(page.finalHost, "www.youtube.com", JSON.stringify(page));
    assert.equal(page.hasInitialData, true, JSON.stringify(page));
    assert.ok(page.videoRenderers > 0, `no videoRenderer in the page: ${JSON.stringify(page)}`);
  } finally {
    await driver.quit();
  }
});

test("the transcript route answers from the extension origin", async () => {
  // Rides the static DNR rule that rewrites Origin on /youtubei/ requests;
  // without it Google bot-blocks the POST with a 403.
  const driver = await buildDriver();
  await driver.manage().setTimeouts({ script: 45_000 });
  try {
    await openExtensionPage(driver, "feed.html?demo=1#/settings");
    const result = await driver.executeAsyncScript(FETCH_TRANSCRIPT, VIDEO_ID, ANDROID_CLIENT);
    assert.equal(result.error, undefined, result.error);
    assert.equal(result.playerStatus, 200, JSON.stringify(result));
    assert.ok(result.tracks > 0, `no caption tracks: ${JSON.stringify(result)}`);
    assert.equal(result.timedtextStatus, 200, JSON.stringify(result));
    assert.ok(result.timedtextBytes > 0, `empty transcript body: ${JSON.stringify(result)}`);
  } finally {
    await driver.quit();
  }
});
