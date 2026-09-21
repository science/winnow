// Diagnostic, not a test: the signed-in pass on a real phone, without a human
// tapping through it. geckodriver's normal launch erases the app's data, so
// it can never see a signed-in YouTube session. This attaches to the ALREADY
// signed-in Firefox instead:
//   - a geckoview-config.yaml in /data/local/tmp turns Marionette on (Firefox
//     reads it because the package is made Android's "debug app");
//   - geckodriver runs with --connect-existing, so nothing is launched,
//     pushed or cleared;
//   - the add-on zip travels as base64 into the browser's chrome context,
//     which writes it to the app's temp dir and installs it temporarily.
// Everything it changed is undone at the end (the add-on, its storage — which
// Firefox for Android would otherwise keep — prefs, debug-app, config file)
// unless KEEP=1.
//
// It spends real provider money (cents; OPENAI_API_KEY and the profile text
// from .env.production) and, in the account-writes step, puts ONE video into
// the signed-in account's YouTube watch history. Never part of a tier.
//
//   WINNOW_TARGET=android WINNOW_ANDROID_SERIAL=<serial> \
//   WINNOW_ANDROID_PACKAGE=org.mozilla.firefox_beta ADB=/usr/bin/adb \
//   node e2e/android/signedin-diag.mjs
import { strict as assert } from "node:assert";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { Builder, By } from "selenium-webdriver";
import { ANDROID_CLIENT } from "../../src/lib/innertubeClient.ts";
import { ANDROID, chromeScript, openExtensionPage, UUID } from "../extension/driver.mjs";

assert.ok(ANDROID, "run with WINNOW_TARGET=android");
process.loadEnvFile(".env.production");
const SERIAL = process.env["WINNOW_ANDROID_SERIAL"];
const PACKAGE = process.env["WINNOW_ANDROID_PACKAGE"];
assert.ok(SERIAL && PACKAGE, "WINNOW_ANDROID_SERIAL and WINNOW_ANDROID_PACKAGE are required");
const ADB = process.env["ADB"] ?? "adb";
const GECKODRIVER = process.env["GECKODRIVER"] ?? resolve(homedir(), "Android/bin/geckodriver");
const ROOT = resolve(import.meta.dirname, "../..");
const VERSION = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).version;
const ZIP = resolve(ROOT, `web-ext-artifacts/winnow-${VERSION}.zip`);
const ADDON_ID = "winnow@misuse.org";
const CONFIG = `/data/local/tmp/${PACKAGE}-geckoview-config.yaml`;
const HISTORY_VIDEO = "aqz-KE-bpKQ"; // Big Buck Bunny
const STEPS = (process.env["STEPS"] ?? "feed,background,play,deeper,history").split(",");

const adb = (...a) => execFileSync(ADB, ["-s", SERIAL, ...a], { encoding: "utf8" });
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(6), ...a);

adb("shell", `printf 'args:\\n- --marionette\\n- --remote-allow-system-access\\n' > ${CONFIG}`);
adb("shell", "am", "set-debug-app", "--persistent", PACKAGE);
adb("shell", "am", "force-stop", PACKAGE);
adb("shell", "am", "start", "-W", "-n", `${PACKAGE}/org.mozilla.fenix.IntentReceiverActivity`, "-a", "android.intent.action.VIEW", "-d", "about:blank");
adb("forward", "tcp:2829", "tcp:2828");
const gd = spawn(GECKODRIVER, ["--connect-existing", "--marionette-port", "2829", "--allow-system-access", "--port", "4446"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 4000));

const driver = await new Builder().forBrowser("firefox").usingServer("http://127.0.0.1:4446").build();
await driver.manage().setTimeouts({ script: 120_000 });
let priorUuids = null;

const PAGE = `
const q = (s) => [...document.querySelectorAll(s)];
const text = (s) => q(s).map((e) => e.textContent.trim().replace(/\\s+/g, " ").slice(0, 160));
return {
  status: text("[data-testid='feed-status']")[0] ?? null,
  progress: text("[data-testid='scoring-progress']")[0] ?? null,
  cards: q("[data-testid='video-card']").length,
  top: q("[data-testid='tier-top'] [data-testid='video-card']").length,
  worth: q("[data-testid='tier-worth'] [data-testid='video-card']").length,
  warn: text("[data-testid='feed-warning'],[data-testid='feed-error'],[data-testid='signed-out'],[data-testid='onboarding']"),
  coverage: text("[data-testid='transcript-coverage']")[0] ?? null,
  vis: document.visibilityState,
};`;
const page = async () => {
  try {
    return await driver.executeScript(PAGE);
  } catch (e) {
    return { err: String(e).slice(0, 120) };
  }
};
const FETCH = `
const [url, needle, cb] = arguments;
fetch(url, { credentials: "include", headers: { "Accept-Language": "en-US,en;q=0.9" } }).then(async (res) => {
  const html = await res.text();
  cb({ status: res.status, finalHost: new URL(res.url).hostname, bytes: html.length,
       loggedIn: (/"LOGGED_IN"\\s*:\\s*(true|false)/.exec(html) ?? [])[1] ?? null,
       needleAt: needle ? html.indexOf(needle) : null, firstVideoId: (/"videoId":"([\\w-]{11})"/.exec(html) ?? [])[1] ?? null });
}).catch((e) => cb({ error: String(e) }));`;
const SET = "const [items, cb] = arguments; browser.storage.local.set(items).then(() => cb('ok'), (e) => cb(String(e)));";
const settings = (accountWrites) => ({
  "winnow:settings:v1": { provider: "openai", openaiApiKey: process.env.OPENAI_API_KEY, anthropicApiKey: null, accountWrites },
});

async function playingInPlayer(timeoutMs, tap) {
  const end = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < end) {
    try {
      await driver.switchTo().defaultContent();
      await driver.switchTo().frame(await driver.findElement(By.css("[data-testid='watch-embed']")));
      last = await driver.executeScript("const v = document.querySelector('video'); return v ? { t: v.currentTime, paused: v.paused, muted: v.muted, w: v.videoWidth, err: document.querySelector('.ytp-error')?.textContent ?? null } : null;");
      if (last && !last.paused && last.t > 0) return last;
      if (tap && last && last.paused) {
        // A deep link carries no gesture, so the player waits. Its cued state
        // covers the <video> with a big Play control; a click on the video
        // underneath never arrives.
        const controls = await driver.findElements(By.css(".ytmCuedOverlayPlayButton, .ytp-large-play-button, button[aria-label='Play'], button[aria-label='Play video']"));
        let pressed = null;
        for (const c of controls) {
          if (await c.isDisplayed().catch(() => false)) {
            pressed = await c.getAttribute("class");
            await c.click();
            break;
          }
        }
        if (pressed === null) await driver.actions({ async: true }).move({ origin: await driver.findElement(By.css("video")) }).press().release().perform();
        log("tapped:", pressed ?? "video (pointer)");
        await driver.sleep(2000);
      }
    } catch {
      // The embed swaps documents while loading; try again.
    } finally {
      await driver.switchTo().defaultContent();
    }
    await driver.sleep(1000);
  }
  // Say what the player was showing instead, and keep a picture of it.
  let showing = null;
  try {
    await driver.switchTo().frame(await driver.findElement(By.css("[data-testid='watch-embed']")));
    showing = await driver.executeScript(`
      const seen = [...document.querySelectorAll("button, a, [role='button'], .ytp-error, [class*='overlay']")]
        .filter((e) => e.getClientRects().length > 0)
        .map((e) => (e.tagName + "." + String(e.className).slice(0, 60) + " " + (e.getAttribute("aria-label") ?? e.textContent.trim().slice(0, 40))));
      return { href: location.href.slice(0, 120), text: document.body.innerText.trim().replace(/\\s+/g, " ").slice(0, 300), seen: seen.slice(0, 25) };`);
  } catch (e) {
    showing = { err: String(e).slice(0, 120) };
  } finally {
    await driver.switchTo().defaultContent();
  }
  if (process.env["SHOTS"]) writeFileSync(`${process.env["SHOTS"]}/player-${Date.now()}.png`, await driver.takeScreenshot(), "base64");
  return { timedOut: true, last, showing };
}

try {
  log("install:", await chromeScript(driver, `
    const [id, uuid, b64] = arguments;
    Services.prefs.setStringPref("media.volume_scale", "0.0");
    const prior = Services.prefs.getStringPref("extensions.webextensions.uuids", "{}");
    Services.prefs.setStringPref("extensions.webextensions.uuids", JSON.stringify({ ...JSON.parse(prior), [id]: uuid }));
    const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
    const path = PathUtils.join(PathUtils.tempDir, "winnow-signedin-diag.xpi");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return IOUtils.write(path, bytes)
      .then(() => IOUtils.getFile(path))
      .then((file) => AddonManager.installTemporaryAddon(file))
      .then((addon) => ({ prior, version: addon.version, id: addon.id }));
  `, ADDON_ID, UUID, readFileSync(ZIP).toString("base64")).then((r) => { priorUuids = r.prior; return { version: r.version, id: r.id }; }));

  await openExtensionPage(driver, "feed.html?demo=1#/settings");
  log("storage already there:", await driver.executeAsyncScript("const cb = arguments[0]; browser.storage.local.get(null).then((all) => cb(Object.keys(all)));"));
  const who = await driver.executeAsyncScript(FETCH, "https://www.youtube.com/?app=desktop", null);
  log("signed in to YouTube?", JSON.stringify(who));
  assert.equal(who.loggedIn, "true", "this Firefox is not signed in to youtube.com — sign in there (a Firefox account is not it) and rerun");

  log("seed:", await driver.executeAsyncScript(SET, {
    ...settings(false),
    "winnow:profiles:v1": { activeProfileId: "uat", profiles: [{ id: "uat", name: process.env.WINNOW_PROFILE_NAME ?? "Default", moreOf: process.env.WINNOW_MORE_OF ?? "", lessOf: process.env.WINNOW_LESS_OF ?? "", updatedAt: 1 }] },
  }));

  if (STEPS.includes("transcripts")) {
    const PROBE = `
      const [videoId, client, cb] = arguments;
      fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", { method: "POST", credentials: "omit",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ context: { client: { ...client, hl: "en" } }, videoId }) })
        .then(async (res) => { const j = await res.json().catch(() => null);
          cb({ videoId, http: res.status, playability: j?.playabilityStatus?.status ?? null, reason: (j?.playabilityStatus?.reason ?? "").slice(0, 80),
               tracks: j?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length ?? 0 }); })
        .catch((e) => cb({ videoId, error: String(e) }));`;
    for (const accountWrites of [false, true]) {
      await openExtensionPage(driver, "feed.html?demo=1#/settings");
      await driver.executeAsyncScript(SET, settings(accountWrites));
      await driver.sleep(1500);
      for (const id of ["iG9CE55wbtY", "aqz-KE-bpKQ", "jNQXAC9IVRw", "Tsd9C2duc58", "XuywMzXJNoo", "xjAHEek7Mvs"]) {
        log(`transcript probe (accountWrites ${accountWrites}):`, JSON.stringify(await driver.executeAsyncScript(PROBE, id, ANDROID_CLIENT)));
      }
    }
  }

  if (STEPS.includes("feed")) {
    await openExtensionPage(driver, "feed.html");
    let sentHome = !STEPS.includes("background");
    let quiet = 0;
    for (let i = 0; i < 300 && quiet < 4; i++) {
      await driver.sleep(3000);
      const s = await page();
      log("feed:", JSON.stringify(s));
      const busy = s.err || s.progress !== null || /Scoring|Loading|Fetching|Reading|Digest|Translat/i.test(s.status ?? "") || (s.cards === 0 && s.warn.length === 0);
      quiet = busy ? 0 : quiet + 1;
      if (!sentHome && /Vetting [1-9]/.test(s.progress ?? "")) {
        sentHome = true;
        log(">>> HOME for 60 s, mid-run");
        adb("shell", "input", "keyevent", "KEYCODE_HOME");
        for (let k = 0; k < 12; k++) {
          await driver.sleep(5000);
          log("bg:", JSON.stringify(await page()));
        }
        log(">>> back to Firefox");
        adb("shell", "monkey", "-p", PACKAGE, "-c", "android.intent.category.LAUNCHER", "1");
      }
    }
    log("FEED RESULT:", JSON.stringify(await page()));
    log("storage bytes:", await driver.executeAsyncScript("const cb = arguments[0]; browser.storage.local.get(null).then((all) => cb(Object.fromEntries(Object.entries(all).map(([k, v]) => [k, JSON.stringify(v).length]))));"));
  }

  if (STEPS.includes("play")) {
    const card = await driver.findElement(By.css("[data-testid='video-card']"));
    await driver.executeScript("arguments[0].scrollIntoView({ block: 'center' });", card);
    await card.click();
    log("PLAY RESULT (tapped first card, default autoplay policy):", JSON.stringify(await playingInPlayer(30_000, false)), await driver.executeScript("return location.hash;"));
    await driver.executeScript("location.hash = '#/';");
    await driver.sleep(1000);
  }

  if (STEPS.includes("deeper")) {
    const deeper = await driver.findElements(By.css("[data-testid='go-deeper']"));
    if (deeper.length === 0) {
      log("DEEPER RESULT: no go-deeper control on the page");
    } else {
      await driver.executeScript("arguments[0].scrollIntoView({ block: 'center' });", deeper[0]);
      await deeper[0].click();
      let d = null;
      for (let i = 0; i < 80; i++) {
        await driver.sleep(3000);
        d = await driver.executeScript(`
          const q = (s) => [...document.querySelectorAll(s)];
          return { status: q("[data-testid='discovery-status']").map((e) => e.textContent.trim().replace(/\\s+/g, " ").slice(0, 200))[0] ?? null,
                   results: q("[data-testid='discovery-results'] [data-testid='video-card']").length,
                   vetting: q("[data-testid='discovery-vetting']").length,
                   warn: q("[data-testid='feed-warning'],[data-testid='feed-error']").map((e) => e.textContent.trim().slice(0, 160)) };`);
        log("deeper:", JSON.stringify(d));
        if (d.results > 0 && d.vetting === 0) break;
      }
      log("DEEPER RESULT:", JSON.stringify(d));
    }
  }

  if (STEPS.includes("history")) {
    const HISTORY = "https://www.youtube.com/feed/history?app=desktop";
    const before = await driver.executeAsyncScript(FETCH, HISTORY, `"videoId":"${HISTORY_VIDEO}"`);
    log("history before:", JSON.stringify(before));
    await openExtensionPage(driver, "feed.html?demo=1#/settings");
    log("account writes on:", await driver.executeAsyncScript(SET, settings(true)));
    await openExtensionPage(driver, `feed.html#/watch/${HISTORY_VIDEO}`);
    log("player:", JSON.stringify(await playingInPlayer(40_000, true)));
    await driver.sleep(Number(process.env["WATCH_MS"] ?? 40_000));
    log("player after 40 s:", JSON.stringify(await playingInPlayer(5_000, false)));
    let after = null;
    for (let i = 0; i < 6; i++) {
      after = await driver.executeAsyncScript(FETCH, HISTORY, `"videoId":"${HISTORY_VIDEO}"`);
      log("history after:", JSON.stringify(after));
      if (after.firstVideoId === HISTORY_VIDEO) break;
      await driver.sleep(10_000);
    }
    log("HISTORY RESULT:", JSON.stringify({ wasTopBefore: before.firstVideoId === HISTORY_VIDEO, isTopAfter: after?.firstVideoId === HISTORY_VIDEO }));
  }
} finally {
  if (process.env["KEEP"] !== "1") {
    // Firefox for Android keeps a temporary add-on's storage after uninstall
    // (measured 2026-09-21) — and this script put a real API key in it.
    log("storage cleared:", await openExtensionPage(driver, "feed.html?demo=1#/settings")
      .then(() => driver.executeAsyncScript("const cb = arguments[0]; browser.storage.local.clear().then(() => browser.storage.local.get(null)).then((all) => cb(Object.keys(all).length === 0), (e) => cb(String(e)));"))
      .catch((e) => `FAILED: ${e}`));
    log("cleanup:", await chromeScript(driver, `
      const [id, prior] = arguments;
      Services.prefs.clearUserPref("media.volume_scale");
      if (prior === null || prior === "{}") Services.prefs.clearUserPref("extensions.webextensions.uuids");
      else Services.prefs.setStringPref("extensions.webextensions.uuids", prior);
      const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
      return AddonManager.getAddonByID(id).then((a) => (a ? a.uninstall() : null)).then(() => "add-on removed, prefs restored");
    `, ADDON_ID, priorUuids).catch((e) => `FAILED: ${e}`));
    adb("shell", "am", "clear-debug-app");
    adb("shell", "rm", "-f", CONFIG);
  }
  // Not driver.quit(): with --connect-existing that would shut the person's browser down.
  gd.kill();
  adb("forward", "--remove", "tcp:2829");
}
