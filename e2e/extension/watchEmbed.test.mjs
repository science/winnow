// Extension-tier e2e: installs the built zip into REAL Firefox (headless,
// via geckodriver) and verifies the watch-page player from a genuine
// moz-extension:// origin — the only context that reproduces YouTube's
// error 153 (Firefox sends no Referer from extension pages; see
// docs/DEVELOPMENT.md, error-153 invariant). Playwright cannot load Firefox
// extensions, hence selenium here. Live network to youtube-nocookie.com.
//
// Run: npm run test:e2e:ext  (builds + zips first; manual tier, not CI)
import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { test, before, after } from "node:test";
import { Builder, By, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";

const ROOT = resolve(import.meta.dirname, "../..");
const ZIP = process.env["WINNOW_ZIP"] ?? resolve(ROOT, "web-ext-artifacts/winnow-0.1.0.zip");
// Pre-seeded so the extension-page URL is deterministic (Firefox otherwise
// assigns a random per-profile UUID).
const UUID = "d3adbeef-0000-4000-8000-000000000001";
const VIDEO_ID = "jNQXAC9IVRw"; // "Me at the zoo" — stable, embeddable

let driver;

before(async () => {
  assert.ok(existsSync(ZIP), `${ZIP} missing — run \`npm run zip\` first`);
  const options = new firefox.Options()
    .addArguments("-headless")
    .setPreference(
      "extensions.webextensions.uuids",
      JSON.stringify({ "winnow@misuse.org": UUID }),
    );
  const builder = new Builder().forBrowser("firefox").setFirefoxOptions(options);
  if (existsSync("/snap/bin/geckodriver")) {
    builder.setFirefoxService(new firefox.ServiceBuilder("/snap/bin/geckodriver"));
  }
  driver = await builder.build();
  await driver.installAddon(ZIP, true);
});

after(async () => {
  await driver?.quit();
});

test("watch page reaches a playable player from a real moz-extension:// origin", async () => {
  await driver.get(`moz-extension://${UUID}/feed.html?demo=1#/watch/${VIDEO_ID}`);
  await driver.wait(until.elementLocated(By.css("[data-testid='watch-embed']")), 15_000);

  // Poll until the player commits: either the error screen or the play button.
  // The embed replaces its bootstrap document while loading, which detaches
  // the frame context mid-poll; driver.wait aborts on a thrown error (it only
  // retries falsy returns), so re-enter the frame every poll and map any
  // WebDriver error to "not ready yet".
  const outcome = await driver.wait(async () => {
    try {
      await driver.switchTo().defaultContent();
      const iframe = await driver.findElement(By.css("[data-testid='watch-embed']"));
      await driver.switchTo().frame(iframe);
      const body = await driver.findElement(By.css("body")).getText();
      if (body.includes("Video player configuration error") || body.includes("Error 153")) {
        return { state: "error", body };
      }
      const play = await driver.findElements(By.css("button[aria-label='Play video']"));
      if (play.length > 0) return { state: "playable", body };
      return null;
    } catch {
      return null;
    }
  }, 30_000, "player never reached an error or playable state");

  assert.equal(
    outcome.state,
    "playable",
    `expected a playable player, got the YouTube error screen:\n${outcome.body}`,
  );
});
