import { derived, get, writable } from "svelte/store";
import type { Video, VideoScore, ScoredVideo } from "../lib/types";
import { bucketVideos, scoresCollapse, type Tiers } from "../lib/tiers";
import { KEYS, storageGet, storageSet } from "../lib/storage";
import { loadFeeds } from "../services/youtube/feedSource";
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

export const tiers = derived([scoredVideos, watched], ([$scored, $watched]): Tiers => {
  return bucketVideos($scored, new Set(Object.keys($watched)));
});

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

/** Drop watched entries whose videos left the feed window. */
async function pruneStaleEntries(current: Video[]): Promise<void> {
  const ids = new Set(current.map((v) => v.id));
  const w = get(watched);
  const pruned = Object.fromEntries(Object.entries(w).filter(([id]) => ids.has(id)));
  if (Object.keys(pruned).length !== Object.keys(w).length) {
    watched.set(pruned);
    await storageSet(KEYS.watched, pruned);
  }
}
