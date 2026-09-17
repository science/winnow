// Data-source seam: real credentialed fetches in the extension, fixture
// data in demo mode (?demo=1) so the page runs in a plain browser for
// dev and e2e without touching youtube.com.

import type { SubscribedChannel, Video } from "../../lib/types";
import { parseChannelsPage, parseFeedPage } from "./feedParser";
import { fetchFeedPage, SignedOutError } from "./ytPage";
import { proxySubscribedChannels } from "../../lib/subscriptions";
import { log } from "../../lib/logger";
import { isDemoMode } from "../../lib/demoMode";

export { isDemoMode };

export interface FeedLoad {
  videos: Video[];
  /** Non-fatal per-feed failures, for the status line. */
  warnings: string[];
  signedOut: boolean;
}

/** ?slow=1 alongside ?demo=1: the demo scorer delays each batch so e2e can
 * observe in-progress scoring states (progress panel, hidden unvetted cards). */
export function isSlowDemo(): boolean {
  return typeof location !== "undefined" && new URLSearchParams(location.search).has("slow");
}

async function loadDemo(): Promise<FeedLoad> {
  const [subs, home] = await Promise.all([
    import("./fixtures/subscriptions-videorenderer.json"),
    import("./fixtures/home-lockup-signedin.json"),
  ]);
  const videos = [
    ...parseFeedPage(subs.default, "subscriptions"),
    ...parseFeedPage(home.default, "home"),
  ];
  return { videos: dedupe(videos), warnings: [], signedOut: false };
}

function dedupe(videos: Video[]): Video[] {
  const seen = new Set<string>();
  return videos.filter((v) => (seen.has(v.id) ? false : (seen.add(v.id), true)));
}

export const GLOBAL_VIDEO_CAP = 300;

/** Load and merge both feeds. Individual feed failures degrade to warnings;
 * signed-out is fatal (nothing can load). */
export async function loadFeeds(): Promise<FeedLoad> {
  if (isDemoMode()) return loadDemo();

  const results = await Promise.allSettled([
    fetchFeedPage("subscriptions").then((p) => parseFeedPage(p.data, "subscriptions")),
    fetchFeedPage("home").then((p) => parseFeedPage(p.data, "home")),
  ]);

  const warnings: string[] = [];
  let signedOutCount = 0;
  const videos: Video[] = [];
  const labels = ["subscriptions", "home recommendations"] as const;
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      videos.push(...r.value);
      if (r.value.length === 0) warnings.push(`No videos found in ${labels[i]} — the parser may need updating.`);
    } else if (r.reason instanceof SignedOutError) {
      signedOutCount++;
    } else {
      log.warn("feed load failed", labels[i], r.reason);
      warnings.push(`Couldn't load ${labels[i]}: ${r.reason instanceof Error ? r.reason.message : "unknown error"}`);
    }
  });

  return {
    videos: dedupe(videos).slice(0, GLOBAL_VIDEO_CAP),
    warnings,
    signedOut: signedOutCount === results.length,
  };
}

export interface SubscriptionsLoad {
  channels: SubscribedChannel[];
  warnings: string[];
  /** True when the list came from the subscriptions-feed proxy rather than
   * /feed/channels — the set is then incomplete (recent posters only). */
  degraded: boolean;
}

/**
 * Load the user's subscribed channels from /feed/channels. A parse or fetch
 * failure degrades to the proxy set derived from the caller's feed videos
 * rather than failing: an incomplete set still beats none, and discovery
 * must never be blocked by this.
 */
export async function loadSubscribedChannels(feedVideos: Video[]): Promise<SubscriptionsLoad> {
  const fallback = (warning: string): SubscriptionsLoad => ({
    channels: proxySubscribedChannels(feedVideos),
    warnings: [warning],
    degraded: true,
  });

  if (isDemoMode()) {
    const page = await import("./fixtures/channels-page.json");
    return { channels: parseChannelsPage(page.default), warnings: [], degraded: false };
  }

  try {
    const page = await fetchFeedPage("channels");
    const channels = parseChannelsPage(page.data);
    if (channels.length === 0) {
      return fallback(
        "Couldn't read your subscription list — the parser may need updating. Falling back to channels seen in your subscriptions feed.",
      );
    }
    return { channels, warnings: [], degraded: false };
  } catch (err) {
    if (err instanceof SignedOutError) throw err;
    log.warn("subscribed channels load failed", err);
    return fallback(
      `Couldn't load your subscription list: ${err instanceof Error ? err.message : "unknown error"}`,
    );
  }
}
