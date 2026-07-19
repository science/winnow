import { derived, get, writable } from "svelte/store";
import type { TranscriptCacheEntry, Video, VideoScore, ScoredVideo } from "../lib/types";
import { bucketVideos, scoresCollapse, type Tiers } from "../lib/tiers";
import { KEYS, profileKeys, storageGet, storageSet } from "../lib/storage";
import { loadFeeds } from "../services/youtube/feedSource";
import { feedback } from "./feedbackStore";
import { profilesReady, profilesState } from "./profilesStore";
import { log } from "../lib/logger";

const VIDEOS_TTL_MS = 30 * 60 * 1000;

export type FeedPhase = "idle" | "loading" | "fetching" | "scoring" | "signedOut" | "error";

export interface FeedStatus {
  phase: FeedPhase;
  detail: string;
  warnings: string[];
  scoredCount: number;
  scoreTotal: number;
}

interface StoredVideos {
  fetchedAt: number;
  videos: Video[];
}

export const videos = writable<Video[]>([]);
export const scores = writable<Record<string, VideoScore>>({});
export const pendingScores = writable<Set<string>>(new Set());
export const watched = writable<Record<string, number>>({});
export const status = writable<FeedStatus>({
  phase: "idle",
  detail: "",
  warnings: [],
  scoredCount: 0,
  scoreTotal: 0,
});

/** Session-only transcript coverage from the last scoring run — the
 * production-visible signal that the transcript seam works (log.info is
 * stripped from prod builds). Null until a run attempts transcripts. */
export const transcriptCoverage = writable<{
  fetched: number;
  attempted: number;
  failures: Record<string, number>;
} | null>(null);

export const scoredVideos = derived(
  [videos, scores, pendingScores],
  ([$videos, $scores, $pending]): ScoredVideo[] =>
    $videos.map((v) => {
      const s = $scores[v.id];
      if (s) {
        return { ...v, scoreState: "scored", score: s.score, reason: s.reason, clickbait: s.clickbait };
      }
      return { ...v, scoreState: $pending.has(v.id) ? "pending" : "unknown" };
    }),
);

export const tiers = derived(
  [scoredVideos, watched, feedback],
  ([$scored, $watched, $feedback]): Tiers => {
    return bucketVideos($scored, new Set(Object.keys($watched)), $feedback);
  },
);

export const collapsed = derived(scoredVideos, ($scored) => scoresCollapse($scored));

let fetchedAt = 0;

export async function initFeed(): Promise<void> {
  status.update((s) => ({ ...s, phase: "loading", detail: "Loading…" }));
  const [storedVideos, storedWatched] = await Promise.all([
    storageGet<StoredVideos>(KEYS.videos),
    storageGet<Record<string, number>>(KEYS.watched),
  ]);
  if (storedWatched) watched.set(storedWatched);
  if (storedVideos) {
    videos.set(storedVideos.videos);
    fetchedAt = storedVideos.fetchedAt;
  }
  status.update((s) => ({ ...s, phase: "idle", detail: "" }));
  if (!storedVideos || Date.now() - fetchedAt > VIDEOS_TTL_MS) {
    await refresh();
  }
}

export async function refresh(): Promise<void> {
  const current = get(status).phase;
  if (current === "fetching") return;
  status.update((s) => ({ ...s, phase: "fetching", detail: "Fetching your feeds…", warnings: [] }));
  try {
    const load = await loadFeeds();
    if (load.signedOut) {
      status.update((s) => ({ ...s, phase: "signedOut", detail: "" }));
      return;
    }
    fetchedAt = Date.now();
    videos.set(load.videos);
    await storageSet<StoredVideos>(KEYS.videos, { fetchedAt, videos: load.videos });
    await pruneStaleEntries(load.videos);
    status.update((s) => ({
      ...s,
      phase: "idle",
      detail: "",
      warnings: load.warnings,
    }));
  } catch (err) {
    log.error("refresh failed", err);
    status.update((s) => ({
      ...s,
      phase: "error",
      detail: err instanceof Error ? err.message : "Unknown error",
    }));
  }
}

export async function markWatched(videoId: string): Promise<void> {
  const next = { ...get(watched), [videoId]: Date.now() };
  watched.set(next);
  await storageSet(KEYS.watched, next);
}

/** Drop watched marks and transcript-cache entries whose videos left the
 * feed window. Transcripts for videos voted in ANY profile are kept —
 * feedback analysis needs them after the video is gone, and only the active
 * profile's votes are in memory. The feedback stores themselves are never
 * pruned here (bounded by FEEDBACK_STORE_CAP instead). Exported for tests. */
export async function pruneStaleEntries(current: Video[]): Promise<void> {
  await profilesReady;
  const ids = new Set(current.map((v) => v.id));
  // Discovered videos (any profile) are part of the live window too — their
  // watched marks and caches must survive feed refreshes.
  for (const p of get(profilesState).profiles) {
    const disc = await storageGet<{ entries?: { video?: { id?: string } }[] }>(
      profileKeys(p.id).discovered,
    );
    for (const e of disc?.entries ?? []) {
      if (typeof e?.video?.id === "string") ids.add(e.video.id);
    }
  }
  const w = get(watched);
  const pruned = Object.fromEntries(Object.entries(w).filter(([id]) => ids.has(id)));
  if (Object.keys(pruned).length !== Object.keys(w).length) {
    watched.set(pruned);
    await storageSet(KEYS.watched, pruned);
  }
  const votedIds = new Set(Object.keys(get(feedback)));
  for (const p of get(profilesState).profiles) {
    const stored = await storageGet<Record<string, unknown>>(profileKeys(p.id).feedback);
    for (const id of Object.keys(stored ?? {})) votedIds.add(id);
  }
  for (const key of [KEYS.transcripts, KEYS.enrichment]) {
    const cache = await storageGet<Record<string, unknown>>(key);
    if (!cache) continue;
    const kept = Object.fromEntries(
      Object.entries(cache).filter(([id]) => ids.has(id) || votedIds.has(id)),
    );
    if (Object.keys(kept).length !== Object.keys(cache).length) {
      await storageSet(key, kept);
    }
  }
}
