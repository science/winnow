// Per-video resume points. Persistence is explicit at the mutation site
// (feedbackStore/subscriptionsStore pattern), NOT subscribe→persist: the
// player reports ~4 samples a second, and a store subscription would turn
// every one of them into a storage write.

import { get, writable } from "svelte/store";
import {
  prunePositions,
  resumeStartSec,
  updatePositions,
  type PlaybackPosition,
} from "../lib/playbackPosition";
import type { PlayerTelemetry } from "../lib/playerMessage";
import { throttle } from "../lib/throttle";
import { KEYS, storageGet, storageSet } from "../lib/storage";

/** Worst case on a hard kill is losing this much of your place. */
export const PERSIST_INTERVAL_MS = 5000;

export const positions = writable<Record<string, PlaybackPosition>>({});

export const playbackReady: Promise<void> = (async () => {
  const stored = await storageGet<Record<string, PlaybackPosition>>(KEYS.playback);
  if (stored) positions.set(stored);
})();

// The write gate reads the same clock the caller stamps samples with: one
// notion of time for "when did this happen" and "is it time to write", and
// tests drive both without fake timers. Production always passes Date.now.
let sampleNow: () => number = Date.now;

// One throttle instance is correct because exactly one player can be open at
// a time (playerStore holds that invariant). If that ever changes, this needs
// to become per-video.
const persist = throttle(
  () => {
    void storageSet(KEYS.playback, get(positions));
  },
  PERSIST_INTERVAL_MS,
  () => sampleNow(),
);

/**
 * Fold one telemetry sample in. Cheap and synchronous — safe to call at the
 * player's full sample rate.
 *
 * @param now injectable clock, for tests only
 */
export function recordPosition(
  videoId: string,
  telemetry: PlayerTelemetry,
  now: () => number = Date.now,
): void {
  sampleNow = now;
  const current = get(positions);
  const next = updatePositions(current, videoId, {
    positionSec: telemetry.positionSec,
    durationSec: telemetry.durationSec,
    at: now(),
  });
  if (next === current) return;
  positions.set(next);
  // A finished video drops its entry; write that through immediately rather
  // than leaving a stale resume point if the tab closes in the next 5s.
  if (next[videoId] === undefined) {
    persist.cancel();
    void storageSet(KEYS.playback, next);
    return;
  }
  persist.call();
}

/** Write any pending position now (close, unmount, tab hidden). */
export async function flushPositions(): Promise<void> {
  persist.cancel();
  await storageSet(KEYS.playback, get(positions));
}

/** Seconds to start this video at; 0 means from the beginning. */
export function resumeStartFor(videoId: string): number {
  return resumeStartSec(get(positions)[videoId] ?? null);
}

/** Drop positions for videos that left the feed window. Returns true when
 * something was removed, so callers can skip a pointless write. */
export async function prunePositionsTo(keepIds: ReadonlySet<string>): Promise<boolean> {
  const current = get(positions);
  const kept = prunePositions(current, keepIds);
  if (Object.keys(kept).length === Object.keys(current).length) return false;
  positions.set(kept);
  await storageSet(KEYS.playback, kept);
  return true;
}
