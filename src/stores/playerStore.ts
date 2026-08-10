// Which video's inline player is open, and the feed order that must hold
// still while it plays. The open id mirrors the `#/watch/<id>` route (the
// hash IS the state, so Back closes and deep links work); the held order is
// this store's own, because a watched mark, a vote, or a scoring run
// finishing would otherwise move the card and reload its iframe.

import { derived, get, writable, type Readable } from "svelte/store";
import { freezeTiers } from "../lib/tierHold";
import type { Tiers } from "../lib/tiers";
import { markWatched, tiers } from "./feedStore";
import { discoveryTiers } from "./discoveryStore";

const openId = writable<string | null>(null);
const heldTiers = writable<Tiers | null>(null);
const heldDiscoveryTiers = writable<Tiers | null>(null);

export const openVideoId: Readable<string | null> = { subscribe: openId.subscribe };

export const displayTiers = derived([tiers, heldTiers], ([$tiers, $held]): Tiers =>
  freezeTiers($tiers, $held),
);

export const displayDiscoveryTiers = derived(
  [discoveryTiers, heldDiscoveryTiers],
  ([$tiers, $held]): Tiers => freezeTiers($tiers, $held),
);

/**
 * Open a video's player. Must be callable synchronously from the hashchange
 * handler: the order has to be held BEFORE Svelte re-renders, or the keyed
 * each moves the card while the iframe is mounting.
 *
 * Opening a second video while one is already open keeps the first snapshot —
 * re-freezing there would reshuffle the feed under a user who is mid-click.
 */
export function openPlayer(videoId: string): void {
  if (get(openId) === videoId) return;
  if (get(heldTiers) === null) {
    heldTiers.set(get(tiers));
    heldDiscoveryTiers.set(get(discoveryTiers));
  }
  openId.set(videoId);
  void markWatched(videoId);
}

export function closePlayer(): void {
  openId.set(null);
  heldTiers.set(null);
  heldDiscoveryTiers.set(null);
}
