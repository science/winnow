// "Go deeper" orchestrator: query pool → sequential YouTube searches →
// parse → dedupe/merge → persist → score. One modest bounded run per press;
// repeated presses rotate through the pool LRU-wise and never re-surface
// anything this profile has already been shown.

import { get } from "svelte/store";
import type { Video } from "../../lib/types";
import { coalesceRuns } from "../../lib/singleFlight";
import { log } from "../../lib/logger";
import { fnv1a } from "../../lib/profileHash";
import {
  markQueriesUsed,
  mergeDiscovered,
  pickQueries,
} from "../../lib/discovery";
import { profileKeys, storageGet, storageSet } from "../../lib/storage";
import { profilesState } from "../../stores/profilesStore";
import { profile as profileStore, settings, settingsReady } from "../../stores/settingsStore";
import { videos as videosStore } from "../../stores/feedStore";
import {
  commitDiscoveredState,
  discoveredState,
  discoveryReady,
  discoveryStatus,
} from "../../stores/discoveryStore";
import { ensureQueryPool } from "../scoring/discoverQueries";
import { enrichmentModelFor, type StoredTarget } from "../scoring/twoPhase";
import { scoreFeed } from "../scoring/scorer";
import { fetchSearchPage } from "../youtube/ytPage";
import { parseFeedPage } from "../youtube/feedParser";
import { isDemoMode } from "../youtube/feedSource";
import { DEMO_UNVETTED_PREFIX } from "../scoring/demoScorer";

/** Results taken per query — keeps one press bounded (~5 queries × 8). */
export const RESULTS_PER_QUERY = 8;
/** Pause between search fetches: polite pacing, not a rate-limit dodge. */
const QUERY_PACING_MS = 500;

export interface DiscoveryDeps {
  fetchSearchPageFn?: typeof fetchSearchPage;
  scoreFeedFn?: () => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  demo?: boolean;
  /** Throw away the cached query pool and generate a fresh one first. */
  forceRegenerate?: boolean;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Deterministic offline search results so demo mode (and nonlive e2e) can
 * drive the whole go-deeper flow. The last result never scores (unvet id
 * prefix) — the seam for asserting unscored discoveries stay unbrowsable. */
export function demoSearchResults(query: string): Video[] {
  const base = fnv1a(query).slice(0, 5);
  return Array.from({ length: RESULTS_PER_QUERY }, (_unused, i) => {
    const id =
      i === RESULTS_PER_QUERY - 1 ? `${DEMO_UNVETTED_PREFIX}${base}${i}` : `disc${base}00${i}`;
    return {
      id,
      source: "search" as const,
      title: `${query} — result ${i + 1}`,
      channelTitle: "Demo Discovery",
      channelId: null,
      durationText: "12:00",
      durationSec: 720,
      publishedText: "1 week ago",
      publishedAtApprox: null,
      viewCountText: "10K views",
      viewCount: 10_000,
      thumbnailUrl: null,
      descriptionSnippet: `Demo search result for "${query}"`,
      isLive: false,
    };
  });
}

/** One discovery run. Safe to call any time; no-ops with an error status
 * when unconfigured. Exported for tests — the UI uses runDiscovery below. */
export async function runDiscoveryOnce(deps: DiscoveryDeps = {}): Promise<void> {
  await settingsReady;
  await discoveryReady;
  const demo = deps.demo ?? isDemoMode();
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const fetchPage = deps.fetchSearchPageFn ?? fetchSearchPage;
  const scoreFeedFn = deps.scoreFeedFn ?? scoreFeed;

  const $settings = get(settings);
  const $profile = get(profileStore);
  const apiKey =
    $settings.provider === "anthropic" ? $settings.anthropicApiKey : $settings.openaiApiKey;
  if (!demo && (!apiKey || (!$profile.moreOf.trim() && !$profile.lessOf.trim()))) {
    discoveryStatus.set({
      phase: "error",
      detail: "Add an API key and some interest-profile text before going deeper.",
      warnings: [],
    });
    return;
  }

  const runProfileId = get(profilesState).activeProfileId;
  const runKeys = profileKeys(runProfileId);
  const stillCurrent = (): boolean => get(profilesState).activeProfileId === runProfileId;

  discoveryStatus.set({ phase: "generating", detail: "Reading your profile…", warnings: [] });

  let pool;
  try {
    const storedTarget = await storageGet<StoredTarget>(runKeys.profileTarget);
    pool = await ensureQueryPool({
      profileId: runProfileId,
      profile: $profile,
      provider: $settings.provider,
      apiKey: apiKey ?? "demo",
      model: enrichmentModelFor($settings.provider),
      target: storedTarget?.target ?? null,
      force: deps.forceRegenerate,
      demo,
    });
  } catch (err) {
    log.warn("discovery: query generation failed", err);
    if (stillCurrent()) {
      discoveryStatus.set({
        phase: "error",
        detail:
          "Couldn't generate search queries — your AI provider rejected the request. Check the API key in Settings.",
        warnings: [],
      });
    }
    return;
  }

  const picked = pickQueries(pool.queries);
  const collected: { video: Video; query: string }[] = [];
  const succeeded: string[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < picked.length; i++) {
    const query = picked[i]!;
    if (stillCurrent()) {
      discoveryStatus.update((s) => ({
        ...s,
        phase: "searching",
        detail: `Searching YouTube (${i + 1}/${picked.length})…`,
      }));
    }
    try {
      const videos = demo
        ? demoSearchResults(query)
        : parseFeedPage((await fetchPage(query)).data, "search");
      collected.push(...videos.slice(0, RESULTS_PER_QUERY).map((video) => ({ video, query })));
      succeeded.push(query);
    } catch (err) {
      log.warn("discovery: search failed", query, err);
      warnings.push(`Search "${query}" failed — it will be retried on a later run.`);
    }
    if (!demo && i < picked.length - 1) await sleep(QUERY_PACING_MS);
  }

  if (succeeded.length === 0) {
    if (stillCurrent()) {
      discoveryStatus.set({
        phase: "error",
        detail: "Every search failed — YouTube may be unreachable. Try again in a bit.",
        warnings,
      });
    }
    return;
  }

  // Merge against the CAPTURED profile's persisted state — a mid-run switch
  // must not cross-pollinate another profile's discoveries.
  const prior =
    get(profilesState).activeProfileId === runProfileId
      ? discoveredState()
      : ((await storageGet<ReturnType<typeof discoveredState>>(runKeys.discovered)) ?? {
          entries: [],
          seenIds: [],
        });
  const knownIds = new Set(get(videosStore).map((v) => v.id));
  const { state: merged, added } = mergeDiscovered(prior, collected, knownIds, now());
  await commitDiscoveredState(runProfileId, merged);

  const stampedPool = {
    ...pool,
    queries: markQueriesUsed(pool.queries, succeeded, now()),
  };
  await storageSet(runKeys.discoverQueries, stampedPool);

  if (stillCurrent()) {
    const exhausted = stampedPool.queries.every((q) => q.lastUsedAt > 0);
    const detail =
      added > 0
        ? ""
        : exhausted
          ? "No new videos — these queries are spent. Regenerate queries to go further, or sharpen the profile."
          : "No new videos this run — press again to try the remaining queries.";
    discoveryStatus.set({ phase: "idle", detail, warnings });
  }

  if (added > 0) void scoreFeedFn();
}

/** UI entry point: concurrent presses coalesce like scoreFeed does. */
export const runDiscovery: () => Promise<void> = coalesceRuns(() => runDiscoveryOnce());

/** Regenerate the query pool, then run discovery with it. */
export const regenerateQueriesAndDiscover: () => Promise<void> = coalesceRuns(() =>
  runDiscoveryOnce({ forceRegenerate: true }),
);
