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
  // place as rollback safety). Persist flag goes on BEFORE the set so the
  // migrated state lands in storage immediately.
  const legacy = await storageGet<Profile>(KEYS.profile);
  persist = true;
  profilesState.set(initialProfilesState(legacy));
})();

profilesState.subscribe((value) => {
  if (persist) void storageSet(KEYS.profiles, value);
});

export const activeProfileId = derived(profilesState, (s) => s.activeProfileId);

/** Create an empty named profile and switch to it. Returns the new id. */
export async function addProfileAction(name: string): Promise<string> {
  await profilesReady;
  const next = addProfile(get(profilesState), name);
  profilesState.set(next);
  return next.activeProfileId;
}

export async function renameProfileAction(id: string, name: string): Promise<void> {
  await profilesReady;
  profilesState.set(renameProfile(get(profilesState), id, name));
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
  return true;
}
