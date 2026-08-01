// Pure "go deeper" discovery logic: the LLM-generated search-query pool with
// its LRU rotation, and the discovered-videos merge/dedupe/caps. Persistence
// and orchestration live in the services/stores layers.

import type { Video } from "./types";

export interface QueryPoolEntry {
  text: string;
  /** Epoch ms of the last discovery run that used this query; 0 = never. */
  lastUsedAt: number;
}

/** Pool size the generator is clamped to — large enough that repeated
 * "go deeper" presses rotate through fresh searches before exhausting. */
export const QUERY_POOL_MAX = 12;

/** Queries consumed per discovery run (the "modest one-shot" scope). */
export const QUERIES_PER_RUN = 5;

/** Normalize raw LLM output into a pool: trim, drop empties, dedupe
 * case-insensitively (first occurrence wins), cap at QUERY_POOL_MAX. */
export function buildQueryPool(raw: string[], max = QUERY_POOL_MAX): QueryPoolEntry[] {
  const seen = new Set<string>();
  const pool: QueryPoolEntry[] = [];
  for (const item of raw) {
    const text = item.trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    pool.push({ text, lastUsedAt: 0 });
    if (pool.length >= max) break;
  }
  return pool;
}

/** The n least-recently-used queries (never-used first, then oldest stamp);
 * ties keep pool order so picks stay deterministic. */
export function pickQueries(pool: QueryPoolEntry[], n = QUERIES_PER_RUN): string[] {
  return pool
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.lastUsedAt - b.entry.lastUsedAt || a.index - b.index)
    .slice(0, n)
    .map(({ entry }) => entry.text);
}

/** Stamp lastUsedAt on exactly the queries a run consumed. */
export function markQueriesUsed(
  pool: QueryPoolEntry[],
  used: string[],
  now: number,
): QueryPoolEntry[] {
  const usedSet = new Set(used);
  return pool.map((q) => (usedSet.has(q.text) ? { ...q, lastUsedAt: now } : q));
}

// --- discovered videos ------------------------------------------------------

export interface DiscoveredEntry {
  video: Video;
  /** The search query that surfaced this video. */
  query: string;
  discoveredAt: number;
  /** Whether the user already subscribed to this channel when it was found.
   * Stamped at merge time, not derived at render time, so the shelf reflects
   * what was true when the discovery happened. Absent on pre-2026-07-31
   * entries — treat undefined as false. */
  alreadySubscribed?: boolean;
}

/** Per-profile persisted blob (winnow:discovered:v1:<profileId>). */
export interface DiscoveredState {
  entries: DiscoveredEntry[];
  /** Every id a discovery run ever assessed, kept beyond entry eviction so
   * the same recommendation is never re-surfaced for this profile. */
  seenIds: string[];
}

export const DISCOVERED_CAP = 120;
export const SEEN_IDS_CAP = 1000;

/** Most videos one channel may contribute to a single run. A search for
 * "endgame technique" routinely returns eight videos from one creator; without
 * this, one query fills the shelf with one channel and the run reads as
 * narrow even when the queries were broad. Skipped videos are NOT marked
 * seen, so they stay eligible for a later run. */
export const PER_CHANNEL_RUN_CAP = 2;

/** Fold one run's search results into the discovered state. Drops videos
 * already in the feed (knownIds), already seen by this profile, repeated
 * within the run, or beyond one channel's per-run share; evicts the oldest
 * entries beyond the cap (they stay in seenIds); records every added id as
 * seen, FIFO-capped. Videos from `subscribedIds` are marked, not dropped:
 * discovery still shows them, the UI sorts them below genuinely new creators. */
export function mergeDiscovered(
  state: DiscoveredState,
  incoming: { video: Video; query: string }[],
  knownIds: ReadonlySet<string>,
  now: number,
  subscribedIds: ReadonlySet<string> = new Set(),
): { state: DiscoveredState; added: number } {
  const seen = new Set(state.seenIds);
  const inRun = new Set<string>();
  const perChannel = new Map<string, number>();
  const fresh: DiscoveredEntry[] = [];
  for (const { video, query } of incoming) {
    if (knownIds.has(video.id) || seen.has(video.id) || inRun.has(video.id)) continue;
    if (video.channelId) {
      const taken = perChannel.get(video.channelId) ?? 0;
      if (taken >= PER_CHANNEL_RUN_CAP) continue;
      perChannel.set(video.channelId, taken + 1);
    }
    inRun.add(video.id);
    fresh.push({
      video,
      query,
      discoveredAt: now,
      alreadySubscribed: video.channelId !== null && subscribedIds.has(video.channelId),
    });
  }
  const entries = [...state.entries, ...fresh].slice(-DISCOVERED_CAP);
  const seenIds = [...state.seenIds, ...fresh.map((e) => e.video.id)].slice(-SEEN_IDS_CAP);
  return { state: { entries, seenIds }, added: fresh.length };
}
