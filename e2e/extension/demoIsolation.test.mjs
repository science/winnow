// Extension-tier gate: ?demo=1 inside the installed extension never touches
// the user's real browser.storage.local. On 2026-09-16 it did — the fixture
// feed replaced the user's cached feed, and the refresh that followed pruned
// their watched marks, resume points, and caches down to the fixture ids.
//
// Run: npm run test:e2e:ext  (manual tier)
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { By, until } from "selenium-webdriver";
import { buildDriver, openExtensionPage } from "./driver.mjs";

const REAL = {
  "winnow:videos:v1": { fetchedAt: 1, videos: [{ id: "realVideo001", title: "A real video" }] },
  "winnow:watched:v1": { realVideo001: 1, olderVideo02: 2 },
  "winnow:playback:v1": { olderVideo02: { positionSec: 120, durationSec: 600, updatedAt: 3 } },
};

const STORAGE_OP = `
const [op, items, callback] = arguments;
const done = (v) => callback(v ?? null);
if (op === "set") browser.storage.local.set(items).then(() => done("ok"), (e) => done(String(e)));
else browser.storage.local.get(null).then(done, (e) => done(String(e)));
`;

test("demo mode leaves the user's stored data exactly as it was", async () => {
  const driver = await buildDriver();
  await driver.manage().setTimeouts({ script: 20_000 });
  try {
    // A non-demo page to seed "real" data, as a real install would have it.
    await openExtensionPage(driver, "feed.html#/settings");
    await driver.executeAsyncScript(STORAGE_OP, "set", REAL);
    const before = await driver.executeAsyncScript(STORAGE_OP, "get", null);

    // The demo feed loads, scores, and gets watched — every write path.
    await openExtensionPage(driver, "feed.html?demo=1");
    const card = await driver.wait(
      until.elementLocated(By.css("[data-testid='tier-top'] [data-testid='video-card']")),
      20_000,
    );
    await card.click();
    await driver.wait(until.elementLocated(By.css("[data-testid='watch-embed']")), 15_000);
    await driver.sleep(3000);

    const after = await driver.executeAsyncScript(STORAGE_OP, "get", null);
    assert.deepEqual(after, before);
  } finally {
    await driver.quit();
  }
});
