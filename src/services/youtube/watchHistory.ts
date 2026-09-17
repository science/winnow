// Records a Winnow play in the user's YouTube watch history (only when
// Settings.accountWrites is on — the caller's gate). A failure is logged and
// swallowed: history is a side effect, never a reason to disturb playback.

import { isDemoMode } from "../../lib/demoMode";
import { log } from "../../lib/logger";
import { generateCpn, playbackPingUrl } from "../../lib/watchHistory";
import { watchUrl } from "../../lib/embed";
import { extractJsonBlob } from "./pageExtract";

/** The watch page's `playbackTracking.videostatsPlaybackUrl`, or null. */
export function extractPlaybackTrackingUrl(html: string): string | null {
  const raw = extractJsonBlob(html, /var ytInitialPlayerResponse\s*=\s*/);
  if (!raw) return null;
  try {
    const url = JSON.parse(raw)?.playbackTracking?.videostatsPlaybackUrl?.baseUrl;
    return typeof url === "string" ? url : null;
  } catch {
    return null;
  }
}

/** Resolves true when YouTube accepted the ping. Never rejects. */
export async function recordWatch(
  videoId: string,
  deps: { fetchFn?: typeof fetch } = {},
): Promise<boolean> {
  if (isDemoMode()) return false;
  const fetchFn = deps.fetchFn ?? fetch;
  try {
    const page = await fetchFn(watchUrl(videoId), { credentials: "include" });
    if (!page.ok) throw new Error(`watch page HTTP ${page.status}`);
    const trackingUrl = extractPlaybackTrackingUrl(await page.text());
    if (!trackingUrl) throw new Error("no playback tracking URL on the watch page");
    const cpn = generateCpn(crypto.getRandomValues(new Uint8Array(16)));
    const ping = await fetchFn(playbackPingUrl(trackingUrl, cpn), { credentials: "include" });
    if (!ping.ok) throw new Error(`playback ping HTTP ${ping.status}`);
    return true;
  } catch (err) {
    log.warn("couldn't record the play in watch history", videoId, err);
    return false;
  }
}
