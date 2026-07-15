// Provider-agnostic scoring orchestrator: per-item cache misses → batches
// → concurrent provider calls → validated, clamped scores. Retry policy
// (house rule): one backoff retry on 429/5xx/network; fail fast on 4xx and
// malformed responses; auth errors abort the whole run.

import { get } from "svelte/store";
import type { Profile, TranscriptCacheEntry, Video, VideoScore } from "../../lib/types";
import { profileHash } from "../../lib/profileHash";
import { KEYS, storageGet, storageSet } from "../../lib/storage";
import { log } from "../../lib/logger";
import { BATCH_SIZE, FEEDBACK_PROMPT_CAP, PROMPT_VERSION } from "./prompt";
import { recentExamples, type FeedbackExample } from "../../lib/feedback";
import { feedback as feedbackStore, feedbackReady } from "../../stores/feedbackStore";
import { ProviderError, isRetryable, type ScoreBatchFn } from "./providerTypes";
import { scoreBatchAnthropic, ANTHROPIC_MODEL } from "./anthropicScorer";
import { scoreBatchOpenai, OPENAI_MODEL } from "./openaiScorer";
import { scoreBatchDemo, DEMO_MODEL } from "./demoScorer";
import {
  videos as videosStore,
  scores as scoresStore,
  pendingScores,
  status,
  transcriptCoverage,
} from "../../stores/feedStore";
import { settings, profile as profileStore, settingsReady } from "../../stores/settingsStore";
import { fetchTranscriptExcerpt, type TranscriptOutcome } from "../youtube/transcripts";
import { isDemoMode } from "../youtube/feedSource";
import { coalesceRuns } from "../../lib/singleFlight";
import {
  enrichmentModelFor,
  expectedScoresHash,
  runTwoPhaseScoring,
  softScoresHashFor,
} from "./twoPhase";
import type { Settings } from "../../lib/types";

const CONCURRENCY = 2;
const RETRY_DELAY_MS = 2000;

export interface ScoringDeps {
  adapter: ScoreBatchFn;
  model: string;
  apiKey: string;
  profile: Profile;
  /** Recent voted examples included in every batch prompt. */
  feedback?: FeedbackExample[];
  /** Cached scores already valid for the current profile hash. */
  cache: Record<string, VideoScore>;
  sleep?: (ms: number) => Promise<void>;
  /** Called after each successful batch with just that batch's scores. */
  onBatch?: (scores: Record<string, VideoScore>) => void | Promise<void>;
  onProgress?: (scored: number, total: number) => void;
}

export interface ScoringResult {
  /** Merged cache + newly scored. */
  scores: Record<string, VideoScore>;
  /** Videos that ended the run without a score (failed batch / missing id). */
  unknownIds: string[];
  /** Set when the run aborted (invalid API key). */
  fatalError: ProviderError | null;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function runScoring(videos: Video[], deps: ScoringDeps): Promise<ScoringResult> {
  const sleep = deps.sleep ?? defaultSleep;
  const result: ScoringResult = { scores: { ...deps.cache }, unknownIds: [], fatalError: null };

  const misses = videos.filter((v) => !deps.cache[v.id]);
  const batches: Video[][] = [];
  for (let i = 0; i < misses.length; i += BATCH_SIZE) {
    batches.push(misses.slice(i, i + BATCH_SIZE));
  }

  let scored = 0;
  const total = misses.length;
  deps.onProgress?.(0, total);

  let nextBatch = 0;
  let aborted = false;

  async function scoreOneBatch(batch: Video[]): Promise<void> {
    const wanted = new Set(batch.map((v) => v.id));
    let raw;
    try {
      try {
        raw = await deps.adapter(batch, deps.profile, deps.apiKey, deps.feedback);
      } catch (err) {
        if (!isRetryable(err)) throw err;
        log.warn("scoring batch failed, retrying once", err);
        await sleep(RETRY_DELAY_MS);
        raw = await deps.adapter(batch, deps.profile, deps.apiKey, deps.feedback);
      }
    } catch (err) {
      if (err instanceof ProviderError && err.kind === "auth") {
        aborted = true;
        result.fatalError = err;
      } else {
        log.warn("scoring batch failed permanently", err);
      }
      result.unknownIds.push(...wanted);
      scored += batch.length;
      deps.onProgress?.(scored, total);
      return;
    }

    const batchScores: Record<string, VideoScore> = {};
    for (const s of raw) {
      if (!wanted.has(s.videoId)) continue; // hallucinated id
      batchScores[s.videoId] = {
        score: Math.max(0, Math.min(100, Math.round(s.score))),
        reason: s.reason.slice(0, 200),
        clickbait: Boolean(s.clickbait),
        scoredAt: Date.now(),
        model: deps.model,
      };
    }
    for (const id of wanted) {
      if (!batchScores[id]) result.unknownIds.push(id);
    }
    Object.assign(result.scores, batchScores);
    scored += batch.length;
    deps.onProgress?.(scored, total);
    if (Object.keys(batchScores).length > 0) await deps.onBatch?.(batchScores);
  }

  async function worker(): Promise<void> {
    while (nextBatch < batches.length && !aborted) {
      const batch = batches[nextBatch++]!;
      await scoreOneBatch(batch);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Anything never attempted (post-abort) is unknown too.
  if (aborted) {
    const attempted = new Set([...Object.keys(result.scores), ...result.unknownIds]);
    for (const v of misses) {
      if (!attempted.has(v.id)) result.unknownIds.push(v.id);
    }
  }

  return result;
}

interface StoredScores {
  profileHash: string;
  /** Two-phase only: vote-independent run identity (softScoresHashFor). */
  softHash?: string;
  scores: Record<string, VideoScore>;
}

// Transcript enrichment is bounded: watch-page fetches are the heaviest
// YouTube traffic we generate, so cap per scoring run and cache successes
// (winnow:transcripts:v1) so re-scores and feedback analysis never re-fetch.
const TRANSCRIPT_CAP = 60;
const TRANSCRIPT_CONCURRENCY = 2;

export interface EnrichResult {
  videos: Video[];
  /** Videos that ended up with an excerpt (cache hits + fresh fetches). */
  fetched: number;
  /** Videos we wanted an excerpt for this run (post-cap). */
  attempted: number;
  /** Failure-stage counts (e.g. "player-http-403" → 48) so a zero run
   * names its cause in the UI instead of just reading 0/60. */
  failures: Record<string, number>;
}

export interface EnrichDeps {
  fetchExcerpt?: (videoId: string) => Promise<TranscriptOutcome>;
  loadCache?: () => Promise<Record<string, TranscriptCacheEntry> | null>;
  saveCache?: (cache: Record<string, TranscriptCacheEntry>) => Promise<void>;
}

export async function enrichWithTranscripts(
  videos: Video[],
  missIds: Set<string>,
  deps: EnrichDeps = {},
): Promise<EnrichResult> {
  if (isDemoMode()) return { videos, fetched: 0, attempted: 0, failures: {} };
  const fetchExcerpt = deps.fetchExcerpt ?? ((id: string) => fetchTranscriptExcerpt(id));
  const loadCache =
    deps.loadCache ?? (() => storageGet<Record<string, TranscriptCacheEntry>>(KEYS.transcripts));
  const saveCache =
    deps.saveCache ??
    ((cache: Record<string, TranscriptCacheEntry>) => storageSet(KEYS.transcripts, cache));

  const targets = videos.filter((v) => missIds.has(v.id) && !v.isLive).slice(0, TRANSCRIPT_CAP);
  if (targets.length === 0) return { videos, fetched: 0, attempted: 0, failures: {} };

  status.update((s) => ({ ...s, detail: "Fetching transcripts…" }));
  const cache = (await loadCache()) ?? {};
  const excerpts = new Map<string, string>();
  const fresh: Record<string, TranscriptCacheEntry> = {};
  const failures: Record<string, number> = {};

  const toFetch: Video[] = [];
  for (const v of targets) {
    const hit = cache[v.id];
    if (hit) excerpts.set(v.id, hit.excerpt);
    else toFetch.push(v);
  }

  let next = 0;
  async function worker(): Promise<void> {
    while (next < toFetch.length) {
      const v = toFetch[next++]!;
      const outcome = await fetchExcerpt(v.id);
      if ("excerpt" in outcome) {
        excerpts.set(v.id, outcome.excerpt);
        fresh[v.id] = { excerpt: outcome.excerpt, source: outcome.source, fetchedAt: Date.now() };
      } else {
        failures[outcome.failure] = (failures[outcome.failure] ?? 0) + 1;
      }
    }
  }
  await Promise.all(Array.from({ length: TRANSCRIPT_CONCURRENCY }, worker));
  status.update((s) => ({ ...s, detail: "" }));

  if (Object.keys(fresh).length > 0) await saveCache({ ...cache, ...fresh });

  const breakdown = Object.entries(failures)
    .map(([stage, n]) => `${stage} ×${n}`)
    .join(", ");
  log.info(
    `transcripts: ${excerpts.size}/${targets.length} fetched${breakdown ? ` (failures: ${breakdown})` : ""}`,
  );
  return {
    videos: videos.map((v) => {
      const excerpt = excerpts.get(v.id);
      return excerpt ? { ...v, transcriptExcerpt: excerpt } : v;
    }),
    fetched: excerpts.size,
    attempted: targets.length,
    failures,
  };
}

/** Wire runScoring into the app stores. Safe to call any time; no-ops when
 * unconfigured (no key / empty profile) or when nothing needs scoring.
 * Concurrent calls coalesce: the feed remounts on every watch → back
 * navigation, and stacking a second pipeline on an in-flight one would
 * double-fetch transcripts and double-spend provider calls. */
export const scoreFeed: () => Promise<void> = coalesceRuns(scoreFeedOnce);

async function scoreFeedOnce(): Promise<void> {
  await settingsReady;
  const $settings = get(settings);
  const $profile = get(profileStore);
  const demo = isDemoMode();
  const realKey = $settings.provider === "anthropic" ? $settings.anthropicApiKey : $settings.openaiApiKey;
  if (!demo && (!realKey || (!$profile.moreOf.trim() && !$profile.lessOf.trim()))) return;

  // Demo mode always uses the direct path (stub scorer, no network).
  if (!demo && $settings.scoringStrategy === "two-phase") {
    return scoreFeedTwoPhase($settings, $profile, realKey!);
  }

  const apiKey = demo ? "demo" : realKey!;
  // The user-picked model (Settings) rides into both the adapter call and the
  // cache hash, so switching models cleanly invalidates and re-scores.
  const model = demo
    ? DEMO_MODEL
    : $settings.provider === "anthropic"
      ? $settings.anthropicModel || ANTHROPIC_MODEL
      : $settings.openaiModel || OPENAI_MODEL;
  const adapter: ScoreBatchFn = demo
    ? scoreBatchDemo
    : $settings.provider === "anthropic"
      ? (v, p, k, f) => scoreBatchAnthropic(v, p, k, f, model)
      : (v, p, k, f) => scoreBatchOpenai(v, p, k, f, model);
  const hash = profileHash($profile, PROMPT_VERSION, model);

  const stored = await storageGet<StoredScores>(KEYS.scores);
  const cache = stored?.profileHash === hash ? stored.scores : {};
  scoresStore.set(cache);

  const $videos = get(videosStore);
  const misses = $videos.filter((v) => !cache[v.id]);
  if (misses.length === 0) return;

  pendingScores.set(new Set(misses.map((v) => v.id)));
  status.update((s) => ({ ...s, phase: "scoring", scoredCount: 0, scoreTotal: misses.length }));

  const enrichment = await enrichWithTranscripts($videos, new Set(misses.map((v) => v.id)));
  transcriptCoverage.set(
    enrichment.attempted > 0
      ? {
          fetched: enrichment.fetched,
          attempted: enrichment.attempted,
          failures: enrichment.failures,
        }
      : null,
  );

  await feedbackReady;
  const result = await runScoring(enrichment.videos, {
    adapter,
    model,
    apiKey,
    profile: $profile,
    // Votes steer future runs only: feedback is deliberately NOT a
    // profileHash input, so cached scores stand until a natural miss or
    // an explicit "Re-score everything" (see DESIGN.md).
    feedback: recentExamples(get(feedbackStore), FEEDBACK_PROMPT_CAP),
    cache,
    onProgress: (scoredCount, scoreTotal) =>
      status.update((s) => ({ ...s, scoredCount, scoreTotal })),
    onBatch: async (batchScores) => {
      scoresStore.update((s) => ({ ...s, ...batchScores }));
      pendingScores.update((p) => {
        const next = new Set(p);
        for (const id of Object.keys(batchScores)) next.delete(id);
        return next;
      });
      // Persist incrementally so a mid-run close loses nothing.
      await storageSet<StoredScores>(KEYS.scores, { profileHash: hash, scores: get(scoresStore) });
    },
  });

  pendingScores.set(new Set());
  await storageSet<StoredScores>(KEYS.scores, { profileHash: hash, scores: result.scores });

  if (result.fatalError) {
    status.update((s) => ({
      ...s,
      phase: "error",
      detail:
        "Your AI provider rejected the API key (401). Check it in Settings — scoring is paused until then.",
    }));
  } else {
    status.update((s) => ({ ...s, phase: "idle", detail: "" }));
  }
}

/** Two-phase wiring: digests cached per video, profile+votes translated
 * once, the whole feed re-ranked locally every run (docs/TWO_PHASE_SCORING.md).
 * Ranked scores persist in the same store/shape direct mode uses, so
 * everything downstream (tiers, watch page, votes) is strategy-blind. */
async function scoreFeedTwoPhase(
  $settings: Settings,
  $profile: Profile,
  apiKey: string,
): Promise<void> {
  const $videos = get(videosStore);
  if ($videos.length === 0) return;
  const model = enrichmentModelFor($settings.provider);

  await feedbackReady;
  const feedbackExamples = recentExamples(get(feedbackStore), FEEDBACK_PROMPT_CAP);

  // Last run's scores stand (optimistic display) until the re-rank below —
  // when they're provably current (same target, versions, model), or merely
  // vote-stale (same soft hash: only feedback changed, so last run's order is
  // ~right and the vote-informed re-rank lands in place). Truly stale scores
  // (other engine, edited profile, version bump) render as pending instead:
  // half-finished tiers mislead more than a progress bar does.
  const stored = await storageGet<StoredScores>(KEYS.scores);
  const currentHash = await expectedScoresHash($profile, feedbackExamples, model);
  const softHash = softScoresHashFor($profile, model);
  const displayable =
    stored && (stored.profileHash === currentHash || stored.softHash === softHash);
  scoresStore.set(displayable ? stored.scores : {});
  const known = new Set(displayable ? Object.keys(stored.scores) : []);
  pendingScores.set(new Set($videos.filter((v) => !known.has(v.id)).map((v) => v.id)));
  status.update((s) => ({
    ...s,
    phase: "scoring",
    scoredCount: 0,
    scoreTotal: 0,
    detail: "Analyzing videos…",
  }));

  // Transcript excerpts buffered here and merged once — the fetch workers
  // run concurrently and must not race on the stored cache.
  const excerptBuffer: Record<string, TranscriptCacheEntry> = {};
  const result = await runTwoPhaseScoring($videos, {
    provider: $settings.provider,
    apiKey,
    model,
    profile: $profile,
    feedback: feedbackExamples,
    saveExcerpt: async (videoId, excerpt) => {
      excerptBuffer[videoId] = { excerpt, source: "player", fetchedAt: Date.now() };
    },
    onProgress: (scoredCount, scoreTotal) =>
      status.update((s) => ({ ...s, scoredCount, scoreTotal })),
  });

  if (Object.keys(excerptBuffer).length > 0) {
    const cache = (await storageGet<Record<string, TranscriptCacheEntry>>(KEYS.transcripts)) ?? {};
    await storageSet(KEYS.transcripts, { ...cache, ...excerptBuffer });
  }

  transcriptCoverage.set(result.transcripts.attempted > 0 ? result.transcripts : null);
  scoresStore.set(result.scores);
  pendingScores.set(new Set());
  await storageSet<StoredScores>(KEYS.scores, {
    profileHash: result.scoresHash,
    softHash,
    scores: result.scores,
  });

  if (result.fatalError) {
    status.update((s) => ({
      ...s,
      phase: "error",
      detail:
        "Your AI provider rejected the API key (401). Check it in Settings — scoring is paused until then.",
    }));
  } else {
    status.update((s) => ({ ...s, phase: "idle", detail: "" }));
  }
}
