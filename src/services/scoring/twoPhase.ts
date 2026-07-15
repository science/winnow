// Two-phase scoring orchestration (docs/TWO_PHASE_SCORING.md):
//   Phase 1  enrich — cheap model reads metadata + full transcript once per
//            video → VideoDigest, cached in winnow:enrichment:v1 until the
//            content, prompt version, or model changes.
//   Phase 2a translate — one cheap call turns the profile + recent votes
//            into a ProfileTarget, cached in winnow:profileTarget:v1.
//   Phase 2b rank — pure rubricScorer over cached digests, instant.
//
// Cache validity: a digest built WITH a transcript is final for its
// prompt-version/model. A metadata-only digest stays provisional — every run
// retries the transcript (bounded by transcriptCap) and only re-pays the LLM
// when the content hash actually changed (a transcript appeared).

import type {
  EnrichmentEntry,
  Profile,
  ProfileTarget,
  Provider,
  Video,
  VideoDigest,
  VideoScore,
} from "../../lib/types";
import { fnv1a } from "../../lib/profileHash";
import { clampDigest } from "../../lib/digest";
import { canonicalizeTarget, rankVideo, RANKER_VERSION, targetHash } from "../../lib/rubricScorer";
import { KEYS, storageGet, storageSet } from "../../lib/storage";
import { log } from "../../lib/logger";
import type { FeedbackExample } from "../../lib/feedback";
import {
  buildEnrichMessage,
  DIGESTS_SCHEMA,
  ENRICH_BATCH_SIZE,
  ENRICH_SYSTEM_PROMPT,
  ENRICH_TRANSCRIPT_CHARS,
  ENRICHMENT_PROMPT_VERSION,
  type EnrichInput,
} from "./enrichPrompt";
import {
  buildTranslateMessage,
  TARGET_SCHEMA,
  TRANSLATE_SYSTEM_PROMPT,
  TRANSLATOR_PROMPT_VERSION,
} from "./translatePrompt";
import { structuredCall } from "./structuredCall";
import { isRetryable, ProviderError } from "./providerTypes";
import { TRANSCRIPT_EXCERPT_CHARS, type TranscriptOutcome } from "../youtube/transcripts";

// Enrichment models: the cheapest tier per provider — phase 1 is high-volume
// (full transcripts) and taxonomic, not creative. Reviewed constants; both
// participate in the enrichment cache key. gpt-5.4-nano verified against the
// live /v1/models catalog 2026-07-15.
export const ENRICH_ANTHROPIC_MODEL = "claude-haiku-4-5";
export const ENRICH_OPENAI_MODEL = "gpt-5.4-nano";

const CONCURRENCY = 2;
const RETRY_DELAY_MS = 2000;
/** Fresh transcript fetches per run (same budget direct mode uses). */
const TRANSCRIPT_CAP = 60;

export function enrichmentModelFor(provider: Provider): string {
  return provider === "anthropic" ? ENRICH_ANTHROPIC_MODEL : ENRICH_OPENAI_MODEL;
}

export function contentHashFor(video: Video, transcript: string | null): string {
  return fnv1a(`${video.title}|${transcript ?? ""}`);
}

// --- provider adapters ----------------------------------------------------

export type StructuredCallFn = typeof structuredCall;

/** Digest one batch. Returns only well-formed digests for requested ids —
 * hallucinated ids and unclampable digests are dropped, not thrown. */
export async function enrichBatch(
  inputs: EnrichInput[],
  provider: Provider,
  apiKey: string,
  model: string,
  callFn: StructuredCallFn = structuredCall,
): Promise<Map<string, VideoDigest>> {
  const result = await callFn<{ digests?: Array<{ videoId?: string }> }>({
    provider,
    apiKey,
    model,
    system: ENRICH_SYSTEM_PROMPT,
    user: buildEnrichMessage(inputs),
    schema: DIGESTS_SCHEMA,
    name: "digest_videos",
    maxTokens: 8192,
  });
  if (!Array.isArray(result.digests)) {
    throw new ProviderError("bad_response", "enrichment response missing digests array");
  }
  const wanted = new Set(inputs.map((i) => i.video.id));
  const digests = new Map<string, VideoDigest>();
  for (const raw of result.digests) {
    if (typeof raw.videoId !== "string" || !wanted.has(raw.videoId)) continue;
    const digest = clampDigest(raw);
    if (digest) digests.set(raw.videoId, digest);
  }
  return digests;
}

/** Translate the profile (+ recent votes) into a ranked target. */
export async function translateProfile(
  profile: Profile,
  feedback: FeedbackExample[],
  provider: Provider,
  apiKey: string,
  model: string,
  callFn: StructuredCallFn = structuredCall,
): Promise<ProfileTarget> {
  const raw = await callFn<unknown>({
    provider,
    apiKey,
    model,
    system: TRANSLATE_SYSTEM_PROMPT,
    user: buildTranslateMessage(profile, feedback),
    schema: TARGET_SCHEMA,
    name: "translate_profile",
  });
  return canonicalizeTarget(raw);
}

// --- orchestration ---------------------------------------------------------

export interface StoredTarget {
  inputHash: string;
  target: ProfileTarget;
}

/** Cache key for the translated target: every input that changes what the
 * translator would say. */
function targetInputHashFor(profile: Profile, feedback: FeedbackExample[], model: string): string {
  return fnv1a(
    [
      profile.moreOf,
      profile.lessOf,
      String(TRANSLATOR_PROMPT_VERSION),
      model,
      JSON.stringify(feedback),
    ].join("|"),
  );
}

/** Cache key for ranked scores: target semantics + every version that changes
 * ranking or digests. */
function scoresHashFor(target: ProfileTarget, model: string): string {
  return fnv1a(
    [targetHash(target), String(RANKER_VERSION), String(ENRICHMENT_PROMPT_VERSION), model].join("|"),
  );
}

/** Predict the scoresHash the next run will produce, or null when the cached
 * translation is stale (profile/votes/model changed) and the hash cannot be
 * known without an LLM call. Lets the UI decide whether last run's stored
 * scores are still current enough to display while a run is in flight. */
export async function expectedScoresHash(
  profile: Profile,
  feedback: FeedbackExample[],
  model: string,
  loadTarget: () => Promise<StoredTarget | null> = () => storageGet<StoredTarget>(KEYS.profileTarget),
): Promise<string | null> {
  const stored = await loadTarget();
  if (stored?.inputHash !== targetInputHashFor(profile, feedback, model)) return null;
  return scoresHashFor(canonicalizeTarget(stored.target), model);
}

/** Vote-independent identity of a two-phase run: profile text, prompt and
 * ranker versions, model — everything except feedback. When only votes
 * changed, expectedScoresHash is unknowable (the target re-translates) but
 * stored scores matching this hash are still ~right and stay displayed while
 * the re-rank lands in place; blanking the feed for a single vote reads as a
 * full recalc (UAT 2026-07-15). */
export function softScoresHashFor(profile: Profile, model: string): string {
  return fnv1a(
    [
      profile.moreOf,
      profile.lessOf,
      String(TRANSLATOR_PROMPT_VERSION),
      String(RANKER_VERSION),
      String(ENRICHMENT_PROMPT_VERSION),
      model,
    ].join("|"),
  );
}

export interface TwoPhaseDeps {
  provider: Provider;
  apiKey: string;
  /** Enrichment/translator model (cheap tier). */
  model: string;
  profile: Profile;
  feedback?: FeedbackExample[];
  callFn?: StructuredCallFn;
  fetchExcerpt?: (videoId: string, maxChars: number) => Promise<TranscriptOutcome>;
  loadEnrichment?: () => Promise<Record<string, EnrichmentEntry> | null>;
  saveEnrichment?: (cache: Record<string, EnrichmentEntry>) => Promise<void>;
  loadTarget?: () => Promise<StoredTarget | null>;
  saveTarget?: (stored: StoredTarget) => Promise<void>;
  /** Also persist fresh transcript excerpts for direct mode's cache. */
  saveExcerpt?: (videoId: string, excerpt: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (done: number, total: number) => void;
  transcriptCap?: number;
}

export interface TwoPhaseResult {
  scores: Record<string, VideoScore>;
  /** Videos with no usable digest after this run. */
  unknownIds: string[];
  fatalError: ProviderError | null;
  /** Rides into the existing transcript-coverage UI line. */
  transcripts: { fetched: number; attempted: number; failures: Record<string, number> };
  /** Fresh LLM digests this run (0 on a fully cached run). */
  enriched: number;
  target: ProfileTarget;
  /** Cache key component for persisting ranked scores. */
  scoresHash: string;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function entryValid(entry: EnrichmentEntry | undefined, model: string): entry is EnrichmentEntry {
  return Boolean(
    entry && entry.promptVersion === ENRICHMENT_PROMPT_VERSION && entry.model === model,
  );
}

/** Run the full two-phase pipeline over the feed. Never throws: provider
 * failures degrade to unknownIds (auth aborts, like runScoring). */
export async function runTwoPhaseScoring(
  videos: Video[],
  deps: TwoPhaseDeps,
): Promise<TwoPhaseResult> {
  const callFn = deps.callFn ?? structuredCall;
  const sleep = deps.sleep ?? defaultSleep;
  const fetchExcerpt =
    deps.fetchExcerpt ??
    (async (id: string, maxChars: number) => {
      const { fetchTranscriptExcerpt } = await import("../youtube/transcripts");
      return fetchTranscriptExcerpt(id, maxChars);
    });
  const loadEnrichment =
    deps.loadEnrichment ??
    (() => storageGet<Record<string, EnrichmentEntry>>(KEYS.enrichment));
  const saveEnrichment =
    deps.saveEnrichment ??
    ((cache: Record<string, EnrichmentEntry>) => storageSet(KEYS.enrichment, cache));
  const loadTarget = deps.loadTarget ?? (() => storageGet<StoredTarget>(KEYS.profileTarget));
  const saveTarget = deps.saveTarget ?? ((s: StoredTarget) => storageSet(KEYS.profileTarget, s));
  const feedback = deps.feedback ?? [];

  const result: TwoPhaseResult = {
    scores: {},
    unknownIds: [],
    fatalError: null,
    transcripts: { fetched: 0, attempted: 0, failures: {} },
    enriched: 0,
    target: canonicalizeTarget(null),
    scoresHash: "",
  };

  // Phase 2a first — it's one cheap call, and an auth failure here aborts
  // before we spend anything on enrichment.
  const targetInputHash = targetInputHashFor(deps.profile, feedback, deps.model);
  const storedTarget = await loadTarget();
  let target: ProfileTarget;
  if (storedTarget?.inputHash === targetInputHash) {
    target = canonicalizeTarget(storedTarget.target);
  } else {
    try {
      try {
        target = await translateProfile(deps.profile, feedback, deps.provider, deps.apiKey, deps.model, callFn);
      } catch (err) {
        if (!isRetryable(err)) throw err;
        log.warn("profile translation failed, retrying once", err);
        await sleep(RETRY_DELAY_MS);
        target = await translateProfile(deps.profile, feedback, deps.provider, deps.apiKey, deps.model, callFn);
      }
    } catch (err) {
      const pe =
        err instanceof ProviderError
          ? err
          : new ProviderError("bad_response", err instanceof Error ? err.message : String(err));
      result.fatalError = pe.kind === "auth" ? pe : null;
      if (pe.kind !== "auth") log.warn("profile translation failed permanently", pe);
      result.unknownIds = videos.map((v) => v.id);
      return result;
    }
    await saveTarget({ inputHash: targetInputHash, target });
  }
  result.target = target;
  result.scoresHash = scoresHashFor(target, deps.model);

  // Phase 1 — figure out which videos need work.
  const cache = (await loadEnrichment()) ?? {};
  const digests = new Map<string, VideoDigest>();
  const provisional: Video[] = [];
  for (const video of videos) {
    const entry = cache[video.id];
    if (entryValid(entry, deps.model) && entry.hadTranscript) {
      digests.set(video.id, entry.digest);
    } else {
      provisional.push(video);
    }
  }

  // Transcript pass for provisional videos (bounded per run; live streams
  // have no transcript to fetch but still get metadata-only digests).
  const cap = deps.transcriptCap ?? TRANSCRIPT_CAP;
  const toFetch = provisional.filter((v) => !v.isLive).slice(0, cap);
  const transcripts = new Map<string, string>();
  result.transcripts.attempted = toFetch.length;
  let nextFetch = 0;
  async function transcriptWorker(): Promise<void> {
    while (nextFetch < toFetch.length) {
      const video = toFetch[nextFetch++]!;
      const outcome = await fetchExcerpt(video.id, ENRICH_TRANSCRIPT_CHARS);
      if ("excerpt" in outcome) {
        transcripts.set(video.id, outcome.excerpt);
        result.transcripts.fetched += 1;
        await deps.saveExcerpt?.(video.id, outcome.excerpt.slice(0, TRANSCRIPT_EXCERPT_CHARS));
      } else {
        result.transcripts.failures[outcome.failure] =
          (result.transcripts.failures[outcome.failure] ?? 0) + 1;
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, transcriptWorker));

  // Decide what actually needs the LLM: content changed, or never digested.
  const toEnrich: EnrichInput[] = [];
  for (const video of provisional) {
    const transcript = transcripts.get(video.id) ?? null;
    const hash = contentHashFor(video, transcript);
    const entry = cache[video.id];
    if (entryValid(entry, deps.model) && entry.contentHash === hash) {
      digests.set(video.id, entry.digest); // metadata-only digest, unchanged input
    } else {
      toEnrich.push({ video, transcript });
    }
  }

  const batches: EnrichInput[][] = [];
  for (let i = 0; i < toEnrich.length; i += ENRICH_BATCH_SIZE) {
    batches.push(toEnrich.slice(i, i + ENRICH_BATCH_SIZE));
  }

  let done = 0;
  deps.onProgress?.(0, toEnrich.length);
  const freshEntries: Record<string, EnrichmentEntry> = {};
  let nextBatch = 0;
  let aborted = false;

  async function enrichWorker(): Promise<void> {
    while (nextBatch < batches.length && !aborted) {
      const batch = batches[nextBatch++]!;
      let batchDigests: Map<string, VideoDigest> | null = null;
      try {
        try {
          batchDigests = await enrichBatch(batch, deps.provider, deps.apiKey, deps.model, callFn);
        } catch (err) {
          if (!isRetryable(err)) throw err;
          log.warn("enrichment batch failed, retrying once", err);
          await sleep(RETRY_DELAY_MS);
          batchDigests = await enrichBatch(batch, deps.provider, deps.apiKey, deps.model, callFn);
        }
      } catch (err) {
        if (err instanceof ProviderError && err.kind === "auth") {
          aborted = true;
          result.fatalError = err;
        } else {
          log.warn("enrichment batch failed permanently", err);
        }
      }
      for (const { video, transcript } of batch) {
        const digest = batchDigests?.get(video.id);
        if (digest) {
          digests.set(video.id, digest);
          freshEntries[video.id] = {
            digest,
            contentHash: contentHashFor(video, transcript),
            model: deps.model,
            promptVersion: ENRICHMENT_PROMPT_VERSION,
            hadTranscript: transcript !== null,
            enrichedAt: Date.now(),
          };
        }
      }
      done += batch.length;
      deps.onProgress?.(done, toEnrich.length);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, enrichWorker));

  result.enriched = Object.keys(freshEntries).length;
  if (result.enriched > 0) await saveEnrichment({ ...cache, ...freshEntries });

  // Phase 2b — rank everything that has a digest. Pure, instant.
  for (const video of videos) {
    const digest = digests.get(video.id);
    if (!digest) {
      result.unknownIds.push(video.id);
      continue;
    }
    const ranked = rankVideo(digest, target);
    result.scores[video.id] = {
      ...ranked,
      scoredAt: Date.now(),
      model: `two-phase(${deps.model})`,
    };
  }

  log.info(
    `two-phase: ${Object.keys(result.scores).length} ranked, ${result.enriched} freshly enriched, ` +
      `${result.transcripts.fetched}/${result.transcripts.attempted} transcripts, ${result.unknownIds.length} unknown`,
  );
  return result;
}
