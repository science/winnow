// Shared selenium setup for the extension tier: real headless Firefox with
// the built zip installed, and a way to actually reach a moz-extension:// page.
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
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

export async function buildDriver(extraPrefs = {}) {
  assert.ok(existsSync(ZIP), `${ZIP} missing — run \`npm run zip\` first`);
  const options = new firefox.Options()
    .addArguments("-headless")
    .setPreference(
      "extensions.webextensions.uuids",
      JSON.stringify({ "winnow@misuse.org": UUID }),
    );
  for (const [k, v] of Object.entries(extraPrefs)) options.setPreference(k, v);
  const builder = new Builder().forBrowser("firefox").setFirefoxOptions(options);
  // --allow-system-access is what lets openExtensionPage and chromeScript
  // run privileged script. geckodriver 0.37.1 (2026-09-04) refuses the old
  // spelling, a "-remote-allow-system-access" Firefox argument, outright.
  builder.setFirefoxService(
    new firefox.ServiceBuilder(
      existsSync("/snap/bin/geckodriver") ? "/snap/bin/geckodriver" : undefined,
    ).addArguments("--allow-system-access"),
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
 * toolbar button does.
 *
 * @param {import("selenium-webdriver").WebDriver} driver
 * @param {string} path e.g. "feed.html?demo=1#/watch/abc"
 */
export async function openExtensionPage(driver, path) {
  const url = `moz-extension://${UUID}/${path}`;
  await chromeScript(
    driver,
    `const win = Services.wm.getMostRecentWindow("navigator:browser");
     win.gBrowser.selectedTab = win.gBrowser.addTab(arguments[0], {
       triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
     });`,
    url,
  );
  const handles = await driver.getAllWindowHandles();
  await driver.switchTo().window(handles[handles.length - 1]);
  return url;
}
