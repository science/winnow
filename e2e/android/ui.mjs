// Native-UI automation for Firefox for Android: everything outside the web
// content (the ⋮ menu, where an extension's toolbar button lives) is out of
// WebDriver's reach, so it goes through Android's uiautomator over adb.
// All native labels live HERE, not in the tests (house rule for selectors).
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const ADB = process.env["ADB"] ?? resolve(homedir(), "Android/Sdk/platform-tools/adb");
const SERIAL = process.env["WINNOW_ANDROID_SERIAL"] ?? "emulator-5554";
const LABELS = {
  menu: "More options",
  extensions: /^Extensions\b/,
  openWinnow: "Open Winnow", // manifest action.default_title
};

function adb(...args) {
  return execFileSync(ADB, ["-s", SERIAL, ...args], { encoding: "utf8" });
}

/** Every labelled node on screen: { label, bounds }. */
function screenNodes() {
  adb("shell", "uiautomator", "dump", "/sdcard/winnow-ui.xml");
  const xml = adb("shell", "cat", "/sdcard/winnow-ui.xml");
  return [...xml.matchAll(/<node [^>]*?text="([^"]*)"[^>]*?content-desc="([^"]*)"[^>]*?bounds="([^"]*)"/g)]
    .map((m) => ({ label: m[1] || m[2], bounds: m[3] }))
    .filter((n) => n.label);
}

async function tapLabel(matcher, what) {
  const matches = (label) => (typeof matcher === "string" ? label === matcher : matcher.test(label));
  for (let attempt = 0; attempt < 20; attempt++) {
    const node = screenNodes().find((n) => matches(n.label));
    if (node) {
      const [x1, y1, x2, y2] = node.bounds.match(/\d+/g).map(Number);
      adb("shell", "input", "tap", String((x1 + x2) >> 1), String((y1 + y2) >> 1));
      return;
    }
    await sleep(500);
  }
  throw new Error(`${what} never appeared on screen`);
}

/** Press Winnow's toolbar button the way a user does: ⋮ → Extensions → Open Winnow. */
export async function pressToolbarButton() {
  await tapLabel(LABELS.menu, "Firefox's menu button");
  await tapLabel(LABELS.extensions, "the Extensions menu entry");
  await tapLabel(LABELS.openWinnow, "Winnow's toolbar button");
}

/** The hardware/gesture Back action. */
export function pressBack() {
  adb("shell", "input", "keyevent", "KEYCODE_BACK");
}
