// Demo-mode scoring stub: deterministic, offline, key-free. Lets ?demo=1
// exercise the full tiered feed (and lets e2e run with zero network).

import type { Profile, Video } from "../../lib/types";
import { fnv1a } from "../../lib/profileHash";
import type { RawScore } from "./providerTypes";
import { isSlowDemo } from "../youtube/feedSource";

export const DEMO_MODEL = "demo-stub";

/** Ids with this prefix never get a demo score — the deterministic seam for
 * exercising the awaiting-vetting fold in e2e. */
export const DEMO_UNVETTED_PREFIX = "unvet";

const SLOW_DEMO_DELAY_MS = 1500;

const REASONS: Record<string, string> = {
  top: "Substantive and squarely in your interests.",
  mid: "Plausibly worth your time; some hype in the framing.",
  low: "Engagement bait — withheld subject, manufactured urgency.",
};

export async function scoreBatchDemo(
  videos: Video[],
  _profile: Profile,
  _apiKey: string,
): Promise<RawScore[]> {
  if (isSlowDemo()) await new Promise((r) => setTimeout(r, SLOW_DEMO_DELAY_MS));
  return videos.filter((v) => !v.id.startsWith(DEMO_UNVETTED_PREFIX)).map((v) => {
    const h = parseInt(fnv1a(v.id).slice(0, 4), 16) % 100;
    const tier = h >= 60 ? "top" : h >= 25 ? "mid" : "low";
    const score = tier === "top" ? 75 + (h % 25) : tier === "mid" ? 50 + (h % 25) : h;
    return {
      videoId: v.id,
      score,
      reason: REASONS[tier]!,
      clickbait: tier === "low",
    };
  });
}
