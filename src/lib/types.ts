/** Where a video was found: the user's subscriptions feed, YouTube's
 * homepage recommendations, or a Winnow "go deeper" discovery search. */
export type FeedSource = "subscriptions" | "home" | "search";

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

/** "two-phase": cheap-model digest per video (full transcript) + instant
 * local ranking. "direct": single-pass LLM scoring, kept for A/B during the
 * two-phase transition (docs/TWO_PHASE_SCORING.md). */
export type ScoringStrategy = "two-phase" | "direct";

export interface Settings {
  provider: Provider;
  anthropicApiKey: string | null;
  openaiApiKey: string | null;
  /** Direct-mode scoring model per provider; participates in the score-cache
   *  hash, so a change cleanly invalidates and re-scores. Two-phase mode uses
   *  fixed cheap-tier constants instead (twoPhase.ts). */
  anthropicModel: string;
  openaiModel: string;
  scoringStrategy: ScoringStrategy;
}

export interface Profile {
  moreOf: string;
  lessOf: string;
  updatedAt: number;
}

/** One named interest profile in the multi-profile collection. */
export interface ProfileEntry extends Profile {
  id: string;
  name: string;
}

/** The persisted profiles collection (winnow:profiles:v1). Always holds at
 * least one entry; activeProfileId always names a member. */
export interface ProfilesState {
  activeProfileId: string;
  profiles: ProfileEntry[];
}

// --- Two-phase scoring (docs/TWO_PHASE_SCORING.md) ----------------------

/** Numeric 1-5 taxonomy axes shared by the enrichment digest and the
 * profile target. Order is presentation order in reasons. */
export const DIGEST_NUMERIC_FIELDS = [
  "substanceDensity",
  "clickbaitSeverity",
  "claimOverreach",
  "intellectualDemand",
  "productionEffort",
  "novelty",
] as const;
export type DigestNumericField = (typeof DIGEST_NUMERIC_FIELDS)[number];

/** Phase-1 output: a profile-independent digest of one video, produced by a
 * cheap model reading the full transcript (when available) plus metadata.
 * `claimOverreach` is the BS axis: claims stated beyond the support shown. */
export interface VideoDigest extends Record<DigestNumericField, number> {
  /** What the video actually contains/argues — grounded in the transcript. */
  summary: string;
  topics: string[];
  format: string;
  emotionalTone: string;
  /** Concrete manipulation techniques observed (withheld subject, outrage
   * framing, manufactured urgency, …). Empty when clean. */
  hypeSignals: string[];
}

/** One entry in winnow:enrichment:v1. Cached ~forever: invalidated only by
 * content change (new transcript), prompt version bump, or model change. */
export interface EnrichmentEntry {
  digest: VideoDigest;
  contentHash: string;
  model: string;
  promptVersion: number;
  hadTranscript: boolean;
  enrichedAt: number;
}

export interface FieldTarget {
  /** Desired value on the 1-5 axis. */
  target: number;
  /** 0-10; 0 means unconstrained. */
  importance: number;
}

export interface ListTarget {
  items: string[];
  importance: number;
}

/** Phase-2 output: the profile translated into constraints over digest
 * fields. Only constrained fields participate in ranking. */
export interface ProfileTarget {
  fields: Partial<Record<DigestNumericField, FieldTarget>>;
  topicsMore: ListTarget;
  topicsLess: ListTarget;
  formatsAvoid: ListTarget;
  tonesAvoid: ListTarget;
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
  /** The video's enrichment digest at vote time (two-phase engine), so the
   * vote can teach the translator in digest coordinates. Absent on entries
   * from before 2026-07; null when the video was never enriched. */
  digest?: VideoDigest | null;
  /** ENRICHMENT_PROMPT_VERSION that produced the snapshot — digests from
   * older prompts may carry the very mislabels a newer prompt fixed, so
   * consumers only trust version-matched snapshots. */
  digestPromptVersion?: number | null;
}
