// Shared selenium setup for the extension tier: real headless Firefox with
// the built zip installed, and a way to actually reach a moz-extension:// page.
//
// WINNOW_TARGET=android points the same tests at Firefox for Android on the
// emulator (scripts/android-emulator.sh start; `npm run test:e2e:android`).
// Two things that setup needs, both measured 2026-09-21 on Firefox 156:
//  - adb must run as root. geckodriver pushes its profile into the app's
//    storage and an unrooted adb fails it with "fchown failed: Operation not
//    permitted". The google_apis emulator image allows `adb root`; a retail
//    phone does not, so this tier is emulator-only.
//  - Firefox for Android 153+ hangs in its onboarding under automation unless
//    the launch intent carries `automationtest` (geckodriver 0.37 known issue).
//  - The emulator has no GPU. With Firefox's default GPU-process WebRender a
//    video that actually PLAYS freezes Firefox into an ANR and takes Android's
//    system_server down with it (7 of 7 playing sessions; cued-but-paused
//    video is fine, which is what makes it look random). Software WebRender
//    in the parent process plays in real time.
//  - `media.autoplay.default` alone decides nothing on Android: GeckoView
//    asks the app (Firefox's Autoplay site setting) unless
//    `media.geckoview.autoplay.request` is off as well.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { Builder } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";

const ROOT = resolve(import.meta.dirname, "../..");
// Resolve the zip from the CURRENT version. Hardcoding it (as this did until
// 2026-07-31, at "0.1.0") makes the tier silently install whatever ancient
// build is still lying in web-ext-artifacts and report a pass on it — the
// exact failure mode this tier exists to catch.
const VERSION = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).version;
const ZIP = process.env["WINNOW_ZIP"] ?? resolve(ROOT, `web-ext-artifacts/winnow-${VERSION}.zip`);
/** Pre-seeded so the extension-page URL is deterministic (Firefox otherwise
 * assigns a random per-profile UUID). */
export const UUID = "d3adbeef-0000-4000-8000-000000000001";

export const ANDROID = process.env["WINNOW_TARGET"] === "android";
const ANDROID_SERIAL = process.env["WINNOW_ANDROID_SERIAL"] ?? "emulator-5554";
const ANDROID_PACKAGE = process.env["WINNOW_ANDROID_PACKAGE"] ?? "org.mozilla.firefox";
const ADB = process.env["ADB"] ?? resolve(homedir(), "Android/Sdk/platform-tools/adb");

function geckodriverPath() {
  if (process.env["GECKODRIVER"]) return process.env["GECKODRIVER"];
  if (ANDROID) {
    // The snap build is confined away from adb; use a plain binary.
    const plain = resolve(homedir(), "Android/bin/geckodriver");
    assert.ok(existsSync(plain), `${plain} missing — see docs/DEVELOPMENT.md, Android tier`);
    return plain;
  }
  return existsSync("/snap/bin/geckodriver") ? "/snap/bin/geckodriver" : undefined;
}

function androidOptions() {
  assert.ok(existsSync(ADB), `${ADB} missing — run scripts/android-emulator.sh setup`);
  const devices = execFileSync(ADB, ["devices"], { encoding: "utf8" });
  assert.ok(
    new RegExp(`^${ANDROID_SERIAL}\\s+device$`, "m").test(devices),
    `${ANDROID_SERIAL} is not connected — run scripts/android-emulator.sh start`,
  );
  execFileSync(ADB, ["-s", ANDROID_SERIAL, "root"]);
  execFileSync(ADB, ["-s", ANDROID_SERIAL, "wait-for-device"]);
  const options = new firefox.Options();
  // selenium's enableMobile() writes `deviceSerial`, which geckodriver
  // ignores; the capability is `androidDeviceSerial`.
  options.set("moz:firefoxOptions", {
    androidPackage: ANDROID_PACKAGE,
    androidDeviceSerial: ANDROID_SERIAL,
    androidIntentArguments: [
      "-a", "android.intent.action.VIEW",
      "-d", "about:blank",
      "--ez", "automationtest", "true",
    ],
  });
  return options;
}

/**
 * Make a server on this machine's 127.0.0.1 reachable from the browser under
 * test. On the emulator 127.0.0.1 is the phone itself, so the port is
 * reverse-forwarded; on desktop there is nothing to do.
 *
 * @param {number} port
 */
export function exposeLocalPort(port) {
  if (ANDROID) execFileSync(ADB, ["-s", ANDROID_SERIAL, "reverse", `tcp:${port}`, `tcp:${port}`]);
}

export async function buildDriver(extraPrefs = {}) {
  assert.ok(existsSync(ZIP), `${ZIP} missing — run \`npm run zip\` first`);
  const options = ANDROID ? androidOptions() : new firefox.Options().addArguments("-headless");
  options.setPreference(
    "extensions.webextensions.uuids",
    JSON.stringify({ "winnow@misuse.org": UUID }),
  );
  const prefs = { ...extraPrefs };
  if (ANDROID) {
    prefs["gfx.webrender.software"] = true;
    prefs["layers.gpu-process.enabled"] = false;
    if (prefs["media.autoplay.default"] === 0) prefs["media.geckoview.autoplay.request"] = false;
  }
  for (const [k, v] of Object.entries(prefs)) options.setPreference(k, v);
  const builder = new Builder().forBrowser("firefox").setFirefoxOptions(options);
  // --allow-system-access is what lets openExtensionPage and chromeScript
  // run privileged script. geckodriver 0.37.1 (2026-09-04) refuses the old
  // spelling, a "-remote-allow-system-access" Firefox argument, outright.
  builder.setFirefoxService(
    new firefox.ServiceBuilder(geckodriverPath()).addArguments("--allow-system-access"),
  );
  const driver = await builder.build();
  await driver.installAddon(ZIP, true);
  return driver;
}

/**
 * Run script in the browser's chrome (privileged) context, then return to
 * content. For test setup the page itself can't do: planting cookies,
 * observing network requests.
 *
 * @param {import("selenium-webdriver").WebDriver} driver
 * @param {string} script
 * @param {...unknown} args
 */
export async function chromeScript(driver, script, ...args) {
  await driver.setContext(firefox.Context.CHROME);
  try {
    return await driver.executeScript(script, ...args);
  } finally {
    await driver.setContext(firefox.Context.CONTENT);
  }
}

/**
 * Open one of the extension's own pages.
 *
 * `driver.get("moz-extension://…")` used to work; as of Firefox 153 /
 * geckodriver 0.37 Marionette rejects it with "Navigation to … is not allowed
 * in this context", and a `location.href` assignment from content script is
 * denied too. Opening the tab from the browser's chrome context with the
 * system principal is the remaining route — the same thing clicking the
 * toolbar button does. Firefox for Android has no gBrowser; there the tab
 * comes from GeckoViewTabUtil, the module Marionette itself opens tabs with.
 *
 * @param {import("selenium-webdriver").WebDriver} driver
 * @param {string} path e.g. "feed.html?demo=1#/watch/abc"
 */
export async function openExtensionPage(driver, path) {
  const url = `moz-extension://${UUID}/${path}`;
  const before = await driver.getAllWindowHandles();
  await chromeScript(
    driver,
    ANDROID
      ? `const { GeckoViewTabUtil } = ChromeUtils.importESModule(
           "resource://gre/modules/GeckoViewTestUtils.sys.mjs");
         return GeckoViewTabUtil.createNewTab(arguments[0]).then(() => null);`
      : `const win = Services.wm.getMostRecentWindow("navigator:browser");
         win.gBrowser.selectedTab = win.gBrowser.addTab(arguments[0], {
           triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
         });`,
    url,
  );
  const handles = await driver.getAllWindowHandles();
  await driver.switchTo().window(handles.find((h) => !before.includes(h)) ?? handles[handles.length - 1]);
  // On Android the tab's handle exists before the page does; a script run in
  // that gap lands in about:blank, where there is no `browser`.
  await driver.wait(
    () =>
      driver.executeScript(
        "return location.href.startsWith(arguments[0]) && document.readyState === 'complete';",
        `moz-extension://${UUID}/`,
      ),
    20_000,
    `${url} never finished loading`,
  );
  return url;
}
