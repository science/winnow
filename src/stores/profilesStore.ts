// The multi-profile collection (wolfechat pattern: init from storage,
// subscribe → persist). Owns migration from the legacy single-profile key
// and pruning of per-profile cache keys on delete. The `profile` store in
// settingsStore proxies the active entry, so profile consumers stay unaware
// of the collection.

import { derived, get, writable } from "svelte/store";
import type { Profile, ProfilesState } from "../lib/types";
import {
  addProfile,
  deleteProfile,
  initialProfilesState,
  renameProfile,
} from "../lib/profiles";
import { KEYS, profileKeys, storageGet, storageRemove, storageSet } from "../lib/storage";

export const profilesState = writable<ProfilesState>(initialProfilesState(null));

let persist = false;

export const profilesReady: Promise<void> = (async () => {
  const stored = await storageGet<ProfilesState>(KEYS.profiles);
  if (stored && Array.isArray(stored.profiles) && stored.profiles.length > 0) {
    profilesState.set(stored);
    persist = true;
    return;
  }
  // First run on this schema: migrate the legacy single profile (kept in
  // place as rollback safety) and hand its caches to the new first profile.
  // Persist flag goes on BEFORE the set so the migrated state lands in
  // storage immediately.
  const legacy = await storageGet<Profile>(KEYS.profile);
  const state = initialProfilesState(legacy);
  await migrateLegacyCaches(state.activeProfileId);
  persist = true;
  profilesState.set(state);
})();

/** One-time copy of the single-profile caches into the migrated profile's
 * key family. Scores/target move (recomputable, so the originals go);
 * feedback is copied but the v1 blob stays as rollback safety. Runs only in
 * the fresh-migration branch, so a later profile delete can't resurrect it. */
async function migrateLegacyCaches(profileId: string): Promise<void> {
  const keys = profileKeys(profileId);
  const [scores, target, votes] = await Promise.all([
    storageGet(KEYS.scores),
    storageGet(KEYS.profileTarget),
    storageGet(KEYS.feedback),
  ]);
  if (scores !== null) {
    await storageSet(keys.scores, scores);
    await storageRemove(KEYS.scores);
  }
  if (target !== null) {
    await storageSet(keys.profileTarget, target);
    await storageRemove(KEYS.profileTarget);
  }
  if (votes !== null) await storageSet(keys.feedback, votes);
}

profilesState.subscribe((value) => {
  if (persist) void storageSet(KEYS.profiles, value);
});

export const activeProfileId = derived(profilesState, (s) => s.activeProfileId);

/** Reload per-profile companion stores for the (new) active profile.
 * Dynamic imports break the companion-store ↔ profilesStore cycles. */
async function reloadCompanions(profileId: string): Promise<void> {
  const { reloadFeedback } = await import("./feedbackStore");
  const { reloadDiscovered } = await import("./discoveryStore");
  await Promise.all([reloadFeedback(profileId), reloadDiscovered(profileId)]);
}

/** Create an empty named profile and switch to it. Returns the new id. */
export async function addProfileAction(name: string): Promise<string> {
  await profilesReady;
  const next = addProfile(get(profilesState), name);
  profilesState.set(next);
  await reloadCompanions(next.activeProfileId);
  return next.activeProfileId;
}

export async function renameProfileAction(id: string, name: string): Promise<void> {
  await profilesReady;
  profilesState.set(renameProfile(get(profilesState), id, name));
}

/** Switch the active profile: swap the vote set, then kick a scoring run —
 * it loads the target profile's cached scores instantly and only calls the
 * provider for cache misses. Dynamic imports break the store cycle
 * (feedbackStore/scorer both import this module). */
export async function switchProfile(id: string): Promise<void> {
  await profilesReady;
  const current = get(profilesState);
  if (current.activeProfileId === id || !current.profiles.some((p) => p.id === id)) return;
  profilesState.set({ ...current, activeProfileId: id });
  await reloadCompanions(id);
  const { scoreFeed } = await import("../services/scoring/scorer");
  void scoreFeed();
}

/** Delete a profile and prune every per-profile cache key it owned.
 * Returns false when refused (last remaining profile). */
export async function deleteProfileAction(id: string): Promise<boolean> {
  await profilesReady;
  const current = get(profilesState);
  const next = deleteProfile(current, id);
  if (next === current) return false;
  profilesState.set(next);
  await Promise.all(Object.values(profileKeys(id)).map((key) => storageRemove(key)));
  if (next.activeProfileId !== current.activeProfileId) {
    await reloadCompanions(next.activeProfileId);
  }
  return true;
}
