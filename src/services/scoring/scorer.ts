// Provider-agnostic scoring orchestrator: per-item cache misses → batches
// → concurrent provider calls → validated, clamped scores. Retry policy
// (house rule): one backoff retry on 429/5xx/network; fail fast on 4xx and
// malformed responses; auth errors abort the whole run.

import { get } from "svelte/store";
import type { Profile, Video, VideoScore } from "../../lib/types";
import { profileHash } from "../../lib/profileHash";
import { KEYS, storageGet, storageSet } from "../../lib/storage";
import { log } from "../../lib/logger";
import { BATCH_SIZE, PROMPT_VERSION } from "./prompt";
import { ProviderError, isRetryable, type ScoreBatchFn } from "./providerTypes";
import { scoreBatchAnthropic, ANTHROPIC_MODEL } from "./anthropicScorer";
import { scoreBatchOpenai, OPENAI_MODEL } from "./openaiScorer";
import { scoreBatchDemo, DEMO_MODEL } from "./demoScorer";
import { videos as videosStore, scores as scoresStore, pendingScores, status } from "../../stores/feedStore";
import { settings, profile as profileStore, settingsReady } from "../../stores/settingsStore";
import { fetchTranscriptExcerpt } from "../youtube/transcripts";
import { isDemoMode } from "../youtube/feedSource";

const CONCURRENCY = 2;
const RETRY_DELAY_MS = 2000;

export interface ScoringDeps {
  adapter: ScoreBatchFn;
  model: string;
  apiKey: string;
  profile: Profile;
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
        raw = await deps.adapter(batch, deps.profile, deps.apiKey);
      } catch (err) {
        if (!isRetryable(err)) throw err;
        log.warn("scoring batch failed, retrying once", err);
        await sleep(RETRY_DELAY_MS);
        raw = await deps.adapter(batch, deps.profile, deps.apiKey);
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
  scores: Record<string, VideoScore>;
}

// Transcript enrichment is bounded: watch-page fetches are the heaviest
// YouTube traffic we generate, so cap per scoring run and keep results
// transient (scores persist; transcripts are only needed once per video).
const TRANSCRIPT_CAP = 60;
const TRANSCRIPT_CONCURRENCY = 2;

async function enrichWithTranscripts(videos: Video[], missIds: Set<string>): Promise<Video[]> {
  if (isDemoMode()) return videos;
  const targets = videos.filter((v) => missIds.has(v.id) && !v.isLive).slice(0, TRANSCRIPT_CAP);
  if (targets.length === 0) return videos;

  status.update((s) => ({ ...s, detail: "Fetching transcripts…" }));
  const excerpts = new Map<string, string | null>();
  let next = 0;
  async function worker(): Promise<void> {
    while (next < targets.length) {
      const v = targets[next++]!;
      excerpts.set(v.id, await fetchTranscriptExcerpt(v.id));
    }
  }
  await Promise.all(Array.from({ length: TRANSCRIPT_CONCURRENCY }, worker));
  status.update((s) => ({ ...s, detail: "" }));

  const found = [...excerpts.values()].filter(Boolean).length;
  log.info(`transcripts: ${found}/${targets.length} fetched`);
  return videos.map((v) => (excerpts.get(v.id) ? { ...v, transcriptExcerpt: excerpts.get(v.id) } : v));
}

/** Wire runScoring into the app stores. Safe to call any time; no-ops when
 * unconfigured (no key / empty profile) or when nothing needs scoring. */
export async function scoreFeed(): Promise<void> {
  await settingsReady;
  const $settings = get(settings);
  const $profile = get(profileStore);
  const demo = isDemoMode();
  const realKey = $settings.provider === "anthropic" ? $settings.anthropicApiKey : $settings.openaiApiKey;
  if (!demo && (!realKey || (!$profile.moreOf.trim() && !$profile.lessOf.trim()))) return;

  const apiKey = demo ? "demo" : realKey!;
  const adapter = demo
    ? scoreBatchDemo
    : $settings.provider === "anthropic"
      ? scoreBatchAnthropic
      : scoreBatchOpenai;
  const model = demo ? DEMO_MODEL : $settings.provider === "anthropic" ? ANTHROPIC_MODEL : OPENAI_MODEL;
  const hash = profileHash($profile, PROMPT_VERSION, model);

  const stored = await storageGet<StoredScores>(KEYS.scores);
  const cache = stored?.profileHash === hash ? stored.scores : {};
  scoresStore.set(cache);

  const $videos = get(videosStore);
  const misses = $videos.filter((v) => !cache[v.id]);
  if (misses.length === 0) return;

  pendingScores.set(new Set(misses.map((v) => v.id)));
  status.update((s) => ({ ...s, phase: "scoring", scoredCount: 0, scoreTotal: misses.length }));

  const enriched = await enrichWithTranscripts($videos, new Set(misses.map((v) => v.id)));

  const result = await runScoring(enriched, {
    adapter,
    model,
    apiKey,
    profile: $profile,
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
