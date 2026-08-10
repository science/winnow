import type { Tiers } from "./tiers";
import type { ScoredVideo } from "./types";

const TIER_KEYS = ["top", "worthALook", "winnowed", "unscored"] as const;

/**
 * Hold the feed's visual order still while a player is open.
 *
 * Moving an `<iframe>` in the DOM reloads it, and `tiers` re-derives on a
 * watched mark, a vote, or a scoring run finishing — any of which moves the
 * open card inside its keyed `{#each}` and destroys playback mid-video. So
 * while a player is open the lists it lives in render in their held order.
 *
 * Held ids resolve against ALL live tiers, so a video that changed tier stays
 * visually put instead of vanishing. Videos that left the feed window drop
 * out; genuinely new ones append to the tail of their live tier.
 */
export function freezeTiers(live: Tiers, held: Tiers | null): Tiers {
  if (!held) return live;

  const byId = new Map<string, ScoredVideo>();
  for (const key of TIER_KEYS) {
    for (const v of live[key]) byId.set(v.id, v);
  }
  const heldIds = new Set<string>();
  for (const key of TIER_KEYS) {
    for (const v of held[key]) heldIds.add(v.id);
  }

  const frozen: Tiers = { top: [], worthALook: [], winnowed: [], unscored: [] };
  for (const key of TIER_KEYS) {
    // Held slots first, refreshed to the live video object so a score landing
    // mid-hold still renders; then anything the run newly produced.
    for (const v of held[key]) {
      const current = byId.get(v.id);
      if (current) frozen[key].push(current);
    }
    for (const v of live[key]) {
      if (!heldIds.has(v.id)) frozen[key].push(v);
    }
  }
  return frozen;
}
