export type FeedSource = "subscriptions" | "home";

/** One video as parsed from a YouTube page. All metadata fields are
 * best-effort: YouTube serves display text, not structured data. */
export interface Video {
  id: string;
  source: FeedSource;
  title: string;
  channelTitle: string | null;
  channelId: string | null;
  /** Duration as displayed, e.g. "12:34". Null for live streams. */
  durationText: string | null;
  durationSec: number | null;
  /** Relative age as displayed, e.g. "3 weeks ago". */
  publishedText: string | null;
  /** Approximate publish time (epoch ms) derived from publishedText. */
  publishedAtApprox: number | null;
  viewCountText: string | null;
  viewCount: number | null;
  thumbnailUrl: string | null;
  descriptionSnippet: string | null;
  isLive: boolean;
  /** Scoring enrichment — attached at score time from the transcript cache
   * or a fresh fetch; never persisted on the video itself. */
  transcriptExcerpt?: string | null;
}

/** One entry in the persisted transcript cache (winnow:transcripts:v1).
 * Successes only — failures stay retryable on the next scoring run. */
export interface TranscriptCacheEntry {
  excerpt: string;
  /** "timedtext"/"innertube" only appear in caches written before the
   * ANDROID-player route (2026-07-14); new entries are always "player". */
  source: "timedtext" | "innertube" | "player";
  fetchedAt: number;
}

export type ScoreState = "pending" | "scored" | "unknown";

export interface VideoScore {
  score: number;
  reason: string;
  clickbait: boolean;
  scoredAt: number;
  model: string;
}

export type ScoredVideo = Video & {
  scoreState: ScoreState;
  score?: number;
  reason?: string;
  clickbait?: boolean;
};

export type ScoreTier = "top" | "worthALook" | "winnowed" | "unscored";

export type Provider = "anthropic" | "openai";

export interface Settings {
  provider: Provider;
  anthropicApiKey: string | null;
  openaiApiKey: string | null;
  /** Scoring model per provider; participates in the score-cache hash, so a
   *  change cleanly invalidates and re-scores. */
  anthropicModel: string;
  openaiModel: string;
}

export interface Profile {
  moreOf: string;
  lessOf: string;
  updatedAt: number;
}

export type Vote = "up" | "down";

/** One persisted user verdict (winnow:feedback:v1). Snapshots the video's
 * display fields at vote time — the Video object itself gets pruned from
 * the 300-cap feed window, but votes must keep teaching future scoring. */
export interface FeedbackEntry {
  videoId: string;
  vote: Vote;
  votedAt: number;
  title: string;
  channelTitle: string | null;
  durationText: string | null;
  source: FeedSource;
  descriptionSnippet: string | null;
  /** What the model thought when the user voted; null when unscored. */
  score: number | null;
  reason: string | null;
  clickbait: boolean | null;
}
