// Android-only gate for the toolbar button (src/background.ts), pressed
// through Firefox for Android's real menu. Firefox for Android implements no
// browser.windows at all, and its tabs.query is documented as partial ("may
// only return a subset of the matching tabs", bug 1583281) — this is where
// both meet real behavior.
//
// Run: npm run test:e2e:android  (emulator; scripts/android-emulator.sh start)
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ANDROID, UUID, buildDriver, chromeScript } from "../extension/driver.mjs";
import { pressToolbarButton } from "./ui.mjs";

const FEED_URL = `moz-extension://${UUID}/feed.html`;

/** URLs of every open tab. */
async function openTabUrls(driver) {
  const urls = [];
  for (const handle of await driver.getAllWindowHandles()) {
    await driver.switchTo().window(handle);
    urls.push(await driver.getCurrentUrl());
  }
  return urls;
}

/** Errors the extension's own scripts have logged to the browser console. */
function extensionErrors(driver) {
  return chromeScript(
    driver,
    `return Services.console.getMessageArray()
       .filter((m) => m instanceof Ci.nsIScriptError && !(m.flags & Ci.nsIScriptError.warningFlag))
       .filter((m) => m.sourceName.startsWith(arguments[0]))
       .map((m) => m.errorMessage);`,
    `moz-extension://${UUID}/`,
  );
}

const feedTabs = (urls) => urls.filter((u) => u.startsWith(FEED_URL));

test("the toolbar button opens the feed, and a second press never errors", { skip: !ANDROID }, async () => {
  const driver = await buildDriver();
  try {
    await driver.get("https://example.com/");
    await pressToolbarButton();
    await driver.wait(async () => feedTabs(await openTabUrls(driver)).length === 1, 20_000, "the feed never opened");

    // Second press from another tab: the refocus path, where 0.2.4 called
    // the windows API that does not exist here.
    const handles = await driver.getAllWindowHandles();
    await driver.switchTo().window(handles[0]);
    await driver.get("https://example.com/?second");
    await pressToolbarButton();
    await driver.sleep(3000);

    assert.deepEqual(await extensionErrors(driver), []);
    assert.equal(feedTabs(await openTabUrls(driver)).length, 1, "a second press opened a duplicate feed tab");
  } finally {
    await driver.quit();
  }
});
