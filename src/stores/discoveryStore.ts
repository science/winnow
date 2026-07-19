// Per-profile "go deeper" discoveries. Entries render in the feed's
// Discovery section; seenIds stay module-internal (dedupe bookkeeping, not
// UI state). Persistence is explicit at mutation sites (feedbackStore
// pattern) — the orchestrator saves after each run.

import { derived, get, writable } from "svelte/store";
import type { ScoredVideo } from "../lib/types";
import type { DiscoveredEntry, DiscoveredState } from "../lib/discovery";
import { bucketVideos, type Tiers } from "../lib/tiers";
import { profileKeys, storageGet, storageSet } from "../lib/storage";
import { profilesReady, profilesState } from "./profilesStore";
import { feedback } from "./feedbackStore";
import { pendingScores, scores, watched } from "./feedStore";

export interface DiscoveryStatus {
  phase: "idle" | "generating" | "searching" | "error";
  detail: string;
  warnings: string[];
}

export const discovered = writable<DiscoveredEntry[]>([]);
export const discoveryStatus = writable<DiscoveryStatus>({
  phase: "idle",
  detail: "",
  warnings: [],
});

let seenIds: string[] = [];
let loadedProfileId: string | null = null;

/** Swap the in-memory discoveries to another profile's persisted set. */
export async function reloadDiscovered(profileId: string): Promise<void> {
  const stored = await storageGet<DiscoveredState>(profileKeys(profileId).discovered);
  loadedProfileId = profileId;
  seenIds = stored?.seenIds ?? [];
  discovered.set(stored?.entries ?? []);
  discoveryStatus.set({ phase: "idle", detail: "", warnings: [] });
}

export const discoveryReady: Promise<void> = (async () => {
  await profilesReady;
  await reloadDiscovered(get(profilesState).activeProfileId);
})();

/** Current persisted-shape state for the loaded profile. */
export function discoveredState(): DiscoveredState {
  return { entries: get(discovered), seenIds };
}

/** Apply + persist a run's merged state under the profile that ran it.
 * The visible store only updates when that profile is still loaded. */
export async function commitDiscoveredState(
  profileId: string,
  state: DiscoveredState,
): Promise<void> {
  await storageSet(profileKeys(profileId).discovered, state);
  if (loadedProfileId === profileId) {
    seenIds = state.seenIds;
    discovered.set(state.entries);
  }
}

/** Discovered videos joined with their scores — same shape the main feed
 * uses, so VideoCard and bucketVideos work unchanged. */
export const discoveredScored = derived(
  [discovered, scores, pendingScores],
  ([$discovered, $scores, $pending]): ScoredVideo[] =>
    $discovered.map(({ video }) => {
      const s = $scores[video.id];
      if (s) {
        return {
          ...video,
          scoreState: "scored",
          score: s.score,
          reason: s.reason,
          clickbait: s.clickbait,
        };
      }
      return { ...video, scoreState: $pending.has(video.id) ? "pending" : "unknown" };
    }),
);

export const discoveryTiers = derived(
  [discoveredScored, watched, feedback],
  ([$scored, $watched, $feedback]): Tiers =>
    bucketVideos($scored, new Set(Object.keys($watched)), $feedback),
);
