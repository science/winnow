// Extension-tier gate for the "let Winnow act on my YouTube account" option.
//
// The claim the option rests on: in a moz-extension:// page holding the
// youtube.com host permission, Firefox treats an embedded youtube.com player
// as top-level, so it runs on the account's OWN (unpartitioned) cookies —
// its playback/watchtime pings go out as the signed-in user. A headless
// profile has no Google sign-in, so a marker cookie planted in the
// unpartitioned youtube.com jar stands in for the session: if the player can
// see the marker, it can see a real sign-in the same way.
//
// Also gates the Referer rule's scope. Measured 2026-09-16: an unscoped rule
// rewrote the Referer of embeds on ordinary websites too. The runtime rule
// is scoped to this install's moz-extension host; a web page's embed must
// keep its own Referer.
//
// Run: npm run test:e2e:ext  (manual tier, live network to YouTube)
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { test } from "node:test";
import { By, until } from "selenium-webdriver";
import { buildDriver, chromeScript, openExtensionPage } from "./driver.mjs";

const VIDEO_ID = "dQw4w9WgXcQ"; // 3:33 — long enough not to finish mid-test
const PLAYBACK_KEY = "winnow:playback:v1";

const PLANT_MARKER = `
Services.cookies.add(".youtube.com", "/", "WINNOW_E2E_SESSION", "1", true, false, false,
  Date.now() + 1e10, {}, Ci.nsICookie.SAMESITE_NONE, Ci.nsICookie.SCHEME_HTTPS);`;

/** Record the Referer each embed document request was SENT with. Observed
 * at response time: http-on-modify-request observers can run before DNR's
 * rewrite and would report the pre-rewrite header. */
const OBSERVE_EMBEDS = `
const seen = (window.__winnowEmbedReferers = []);
Services.obs.addObserver({ observe(subject) {
  const ch = subject.QueryInterface(Ci.nsIHttpChannel);
  if (!/^https:\\/\\/www\\.youtube(-nocookie)?\\.com\\/embed\\//.test(ch.URI.spec)) return;
  let referer = "";
  try { referer = ch.getRequestHeader("Referer"); } catch {}
  seen.push({ url: ch.URI.spec, referer });
}}, "http-on-examine-response");`;

const READ_STORAGE = `
const [key, callback] = arguments;
browser.storage.local.get(key).then((r) => callback(r[key] ?? null), () => callback(null));
`;

async function enableAccountWrites(driver) {
  await openExtensionPage(driver, "feed.html?demo=1#/settings");
  const toggle = await driver.wait(
    until.elementLocated(By.xpath("//label[contains(., 'Let Winnow act on my YouTube account')]//input")),
    15_000,
  );
  if (!(await toggle.isSelected())) await toggle.click();
  await driver.wait(async () => {
    const stored = await driver.executeAsyncScript(READ_STORAGE, "winnow:settings:v1");
    return stored?.accountWrites === true;
  }, 10_000, "the setting never persisted");
}

/** Poll inside the player frame until it has loaded its own document, then
 * return the script's result. The result is boxed: driver.wait treats a
 * falsy return as "not yet", and an empty document.cookie is a real answer. */
async function inPlayerFrame(driver, script) {
  let lastState = "";
  const boxed = await driver.wait(async () => {
    try {
      await driver.switchTo().defaultContent();
      await driver.switchTo().frame(await driver.findElement(By.css("[data-testid='watch-embed']")));
      const state = await driver.executeScript(
        "return { href: location.href, video: !!document.querySelector('video'), text: document.body?.innerText.slice(0, 120) };",
      );
      if (!state.video) {
        lastState = JSON.stringify(state);
        return null;
      }
      lastState = "";
      return { value: await driver.executeScript(script) };
    } catch (err) {
      lastState = String(err);
      return null;
    }
  }, 30_000).catch((err) => {
    throw new Error(`the player never loaded (last state: ${lastState})`, { cause: err });
  });
  return boxed.value;
}

test("signed-in player: runs on the account's own cookies and still reports its clock", async () => {
  const driver = await buildDriver({ "media.autoplay.default": 0 });
  await driver.manage().setTimeouts({ script: 60_000 });
  try {
    await chromeScript(driver, PLANT_MARKER);
    await enableAccountWrites(driver);
    await openExtensionPage(driver, `feed.html?demo=1#/watch/${VIDEO_ID}`);

    const frame = await driver.wait(
      until.elementLocated(By.css("[data-testid='watch-embed']")),
      15_000,
    );
    assert.match(await frame.getAttribute("src"), /^https:\/\/www\.youtube\.com\/embed\//);

    const inside = await inPlayerFrame(
      driver,
      `return { cookie: document.cookie, body: document.body.innerText };`,
    );
    assert.doesNotMatch(inside.body, /Error 15\d|configuration error/i, inside.body);
    assert.match(
      inside.cookie,
      /WINNOW_E2E_SESSION=1/,
      "the youtube.com player did not see the unpartitioned account cookie jar",
    );

    // Telemetry is origin-filtered; the signed-in player posts from
    // youtube.com, so a stale nocookie filter would record nothing.
    await driver.switchTo().defaultContent();
    await driver.sleep(12_000);
    const positions = await driver.executeAsyncScript(READ_STORAGE, PLAYBACK_KEY);
    assert.ok(
      positions?.[VIDEO_ID]?.positionSec > 0,
      `no position recorded from the signed-in player: ${JSON.stringify(positions)}`,
    );
  } finally {
    await driver.quit();
  }
});

test("read-only (default): the privacy-enhanced player never sees the account cookies", async () => {
  const driver = await buildDriver({ "media.autoplay.default": 0 });
  try {
    await chromeScript(driver, PLANT_MARKER);
    await openExtensionPage(driver, `feed.html?demo=1#/watch/${VIDEO_ID}`);
    const frame = await driver.wait(
      until.elementLocated(By.css("[data-testid='watch-embed']")),
      15_000,
    );
    assert.match(await frame.getAttribute("src"), /^https:\/\/www\.youtube-nocookie\.com\/embed\//);
    const cookie = await inPlayerFrame(driver, "return document.cookie;");
    assert.doesNotMatch(cookie, /WINNOW_E2E_SESSION/);
  } finally {
    await driver.quit();
  }
});

test("the Referer rewrite applies to Winnow's player only, never to other sites' embeds", async () => {
  const server = createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(
      `<!doctype html><iframe width="640" height="360" src="https://www.youtube.com/embed/${VIDEO_ID}"></iframe>`,
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const site = `http://127.0.0.1:${server.address().port}/`;
  const driver = await buildDriver();
  try {
    await chromeScript(driver, OBSERVE_EMBEDS);
    await enableAccountWrites(driver);
    const seenAtLeast = (n) =>
      driver.wait(async () => {
        const all = await chromeScript(driver, "return window.__winnowEmbedReferers;");
        return all.length >= n ? all : null;
      }, 30_000, `never saw ${n} embed response(s)`);

    await openExtensionPage(driver, `feed.html?demo=1#/watch/${VIDEO_ID}`);
    // Navigating away before Winnow's embed has a response would cancel it.
    await seenAtLeast(1);
    await driver.get(site);
    const seen = await seenAtLeast(2);

    const [winnow, other] = seen;
    assert.equal(winnow.referer, "https://winnow.misuse.org/", JSON.stringify(seen));
    assert.equal(other.referer, site, JSON.stringify(seen));
  } finally {
    await driver.quit();
    server.close();
  }
});
