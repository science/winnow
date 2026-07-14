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
  source: "timedtext" | "innertube";
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
}

export interface Profile {
  moreOf: string;
  lessOf: string;
  updatedAt: number;
}
