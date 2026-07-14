import type { ScoredVideo } from "./types";

export const TIER_THRESHOLDS = {
  /** score >= top and not clickbait ⇒ Top picks */
  top: 75,
  /** score >= worthALook ⇒ Worth a look (clickbait top-scorers land here too) */
  worthALook: 50,
} as const;

export interface Tiers {
  top: ScoredVideo[];
  worthALook: ScoredVideo[];
  winnowed: ScoredVideo[];
  unscored: ScoredVideo[];
}

function byRecencyThenWatched(watched: ReadonlySet<string>) {
  return (a: ScoredVideo, b: ScoredVideo): number => {
    const aw = watched.has(a.id) ? 1 : 0;
    const bw = watched.has(b.id) ? 1 : 0;
    if (aw !== bw) return aw - bw;
    const at = a.publishedAtApprox ?? -Infinity;
    const bt = b.publishedAtApprox ?? -Infinity;
    return bt - at;
  };
}

export function bucketVideos(
  videos: ScoredVideo[],
  watched: ReadonlySet<string> = new Set(),
): Tiers {
  const tiers: Tiers = { top: [], worthALook: [], winnowed: [], unscored: [] };
  for (const v of videos) {
    if (v.scoreState !== "scored" || v.score === undefined) {
      tiers.unscored.push(v);
    } else if (v.score >= TIER_THRESHOLDS.top && !v.clickbait) {
      tiers.top.push(v);
    } else if (v.score >= TIER_THRESHOLDS.worthALook) {
      tiers.worthALook.push(v);
    } else {
      tiers.winnowed.push(v);
    }
  }
  const cmp = byRecencyThenWatched(watched);
  tiers.top.sort(cmp);
  tiers.worthALook.sort(cmp);
  tiers.winnowed.sort(cmp);
  tiers.unscored.sort(cmp);
  return tiers;
}

/**
 * Score-collapse guard (movie-night pattern): when scoring fails to
 * differentiate — nearly everything lands in one scored tier — numeric
 * badges are noise and the profile needs sharpening.
 */
export function scoresCollapse(videos: ScoredVideo[]): boolean {
  const scored = videos.filter((v) => v.scoreState === "scored" && v.score !== undefined);
  if (scored.length < 5) return false;
  const tiers = bucketVideos(scored);
  const counts = [tiers.top.length, tiers.worthALook.length, tiers.winnowed.length];
  const max = Math.max(...counts);
  return max / scored.length >= 0.95;
}
