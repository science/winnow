// Data-source seam: real credentialed fetches in the extension, fixture
// data in demo mode (?demo=1) so the page runs in a plain browser for
// dev and e2e without touching youtube.com.

import type { Video } from "../../lib/types";
import { parseFeedPage } from "./feedParser";
import { fetchFeedPage, SignedOutError } from "./ytPage";
import { log } from "../../lib/logger";

export interface FeedLoad {
  videos: Video[];
  /** Non-fatal per-feed failures, for the status line. */
  warnings: string[];
  signedOut: boolean;
}

export function isDemoMode(): boolean {
  return typeof location !== "undefined" && new URLSearchParams(location.search).has("demo");
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
