// The user's YouTube subscribed-channel set. Account-level, not per-profile
// (winnow:subscriptions:v1). Persistence is explicit at mutation sites
// (feedbackStore/discoveryStore pattern) rather than a subscribe→persist
// bridge, because a refresh is a deliberate act with a TTL.

import { derived, get, writable } from "svelte/store";
import type { SubscribedChannel, Video } from "../lib/types";
import { subscribedIdSet } from "../lib/subscriptions";
import { KEYS, storageGet, storageSet } from "../lib/storage";
import { loadSubscribedChannels } from "../services/youtube/feedSource";
import { log } from "../lib/logger";

/** Matches the feed's own TTL — both describe "how stale may YouTube state
 * be before we re-read it". */
const SUBSCRIPTIONS_TTL_MS = 30 * 60 * 1000;

interface StoredSubscriptions {
  fetchedAt: number;
  channels: SubscribedChannel[];
  degraded: boolean;
}

export const subscribedChannels = writable<SubscribedChannel[]>([]);
/** True when the set came from the degraded proxy — callers that would hide
 * things based on membership should stay lenient. */
export const subscriptionsDegraded = writable(false);

export const subscribedIds = derived(subscribedChannels, ($channels) =>
  subscribedIdSet($channels),
);

let fetchedAt = 0;

export const subscriptionsReady: Promise<void> = (async () => {
  const stored = await storageGet<StoredSubscriptions>(KEYS.subscriptions);
  if (stored) {
    fetchedAt = stored.fetchedAt;
    subscribedChannels.set(stored.channels ?? []);
    subscriptionsDegraded.set(stored.degraded ?? false);
  }
})();

async function persist(channels: SubscribedChannel[], degraded: boolean): Promise<void> {
  fetchedAt = Date.now();
  await storageSet<StoredSubscriptions>(KEYS.subscriptions, { fetchedAt, channels, degraded });
}

/**
 * Refresh the subscribed-channel set. No-ops inside the TTL unless forced.
 * Returns any non-fatal warnings for the caller's status line; never throws
 * on parse/fetch trouble (loadSubscribedChannels degrades instead).
 *
 * Takes the feed videos as an argument rather than importing feedStore: the
 * proxy fallback needs them, and feedStore calls this — an import would be a
 * cycle.
 */
export async function refreshSubscriptions(
  feedVideos: Video[],
  force = false,
): Promise<string[]> {
  await subscriptionsReady;
  const fresh = Date.now() - fetchedAt < SUBSCRIPTIONS_TTL_MS;
  if (!force && fresh && get(subscribedChannels).length > 0) return [];

  try {
    const load = await loadSubscribedChannels(feedVideos);
    subscribedChannels.set(load.channels);
    subscriptionsDegraded.set(load.degraded);
    await persist(load.channels, load.degraded);
    return load.warnings;
  } catch (err) {
    // Signed-out is the feed's problem to report, not ours.
    log.warn("refreshSubscriptions failed", err);
    return [];
  }
}
