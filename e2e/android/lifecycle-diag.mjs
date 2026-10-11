// Diagnostic, not a test: what happens to a real scoring run when Firefox for
// Android is backgrounded, or its page dies, midway? Spends real provider
// money (cents; OPENAI_API_KEY from .env.production), so it is never part of
// a tier — run it by hand on the emulator:
//
//   WINNOW_TARGET=android N=48 node e2e/android/lifecycle-diag.mjs            # HOME for 60 s mid-run
//   WINNOW_TARGET=android N=48 RELOAD=1 node e2e/android/lifecycle-diag.mjs   # page death mid-run
//
// Measured 2026-09-21 (Firefox for Android 156): a backgrounded run keeps
// going and completes while hidden; after a page death the restarted run
// needs only the videos not yet digested ("Scoring 0/40" after dying at 8/48).
//
// YouTube budget: a cold run fetches up to 60 transcripts from whatever network
// the device is on. On home Wi-Fi that is the household IP that bulk fetching
// once got Google-blocked (docs/DEVELOPMENT.md invariants); keep reruns few.
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { By, until } from "selenium-webdriver";
import { buildDriver, openExtensionPage } from "../extension/driver.mjs";
process.loadEnvFile(".env.production");
const ADB = `${homedir()}/Android/Sdk/platform-tools/adb`;
const adb = (...a) => execFileSync(ADB, ["-s", "emulator-5554", ...a], { encoding: "utf8" });
const N = Number(process.env.N ?? 24);
const topics = ["rust borrow checker deep dive", "sourdough starter science", "celebrity feud SHOCKING reaction", "woodworking dovetail joints by hand", "linux kernel scheduler internals", "get rich quick crypto secrets", "jazz harmony reharmonization lesson", "DIY solar battery bank build"];
const videos = Array.from({ length: N }, (_, i) => ({ id: `life${String(i).padStart(7, "0")}`, source: "subscriptions", title: `${topics[i % topics.length]} part ${i}`, channelTitle: `Channel ${i % 5}`, channelId: null, durationText: "12:00", durationSec: 720, publishedText: "2 days ago", publishedAtApprox: null, viewCountText: "10K views", viewCount: 10000, thumbnailUrl: null, descriptionSnippet: null, isLive: false }));
const t0 = Date.now(); const log = (...a) => console.error(((Date.now() - t0) / 1000).toFixed(1).padStart(6), ...a);
const driver = await buildDriver();
await driver.manage().setTimeouts({ script: 20000 });
const status = async () => { try { return await driver.executeScript(`const s = document.querySelector("[data-testid='feed-status']"); const scored = document.querySelectorAll("[data-testid='video-card']").length; const warn = [...document.querySelectorAll("[data-testid='feed-warning'],[data-testid='feed-error']")].map(e => e.textContent.trim().slice(0,120)); return { status: s ? s.textContent.trim().replace(/\\s+/g," ") : null, cards: scored, vis: document.visibilityState, warn };`); } catch (e) { return { err: String(e).slice(0, 100) }; } };
try {
  await openExtensionPage(driver, "feed.html#/settings");
  log("seed:", await driver.executeAsyncScript(`const [items, cb] = arguments; browser.storage.local.set(items).then(() => cb("ok"), (e) => cb(String(e)));`, {
    "winnow:settings:v1": { provider: "openai", openaiApiKey: process.env.OPENAI_API_KEY, anthropicApiKey: null },
    "winnow:profiles:v1": { activeProfileId: "life", profiles: [{ id: "life", name: "Default", moreOf: "deep technical and craft content with real substance", lessOf: "clickbait, celebrity drama, get-rich-quick hype", updatedAt: 1 }] },
    "winnow:videos:v1": { fetchedAt: Date.now(), videos },
  }));
  await openExtensionPage(driver, "feed.html");
  for (let i = 0; i < 40; i++) { const s = await status(); log(JSON.stringify(s)); if (/Scoring/.test(s.status ?? "")) break; await driver.sleep(1000); }
  if (process.env.RELOAD === "1") {
    for (let i = 0; i < 60; i++) { const s = await status(); if (/Scoring [1-9]/.test(s.status ?? "")) { log("mid-run:", JSON.stringify(s)); break; } await driver.sleep(500); }
    log(">>> killing the page mid-run (reload)"); await driver.executeScript("location.reload()"); await driver.sleep(1500);
  } else if (process.env.BACKGROUND !== "0") {
    await driver.sleep(Number(process.env.BG_AFTER ?? 2000));
    log(">>> HOME (backgrounding Firefox)"); adb("shell", "input", "keyevent", "KEYCODE_HOME");
    for (let i = 0; i < Number(process.env.BG_SECS ?? 60) / 5; i++) { await driver.sleep(5000); log("bg:", JSON.stringify(await status())); }
    log(">>> returning to Firefox"); adb("shell", "monkey", "-p", "org.mozilla.firefox", "-c", "android.intent.category.LAUNCHER", "1");
  }
  for (let i = 0; i < 40; i++) { await driver.sleep(3000); const s = await status(); log("fg:", JSON.stringify(s)); if (s.status !== null && !/Scoring|Loading|Fetching/i.test(s.status ?? "") ) break; }
  log("final cards:", (await status()).cards, "of", N);
} finally { await driver.quit(); }
