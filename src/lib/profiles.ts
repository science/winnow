// Pure operations on the multi-profile collection. All functions are
// immutable: they return a new state (or the same reference when refusing).
// Persistence and cache-key pruning live in stores/profilesStore.ts.

import type { Profile, ProfileEntry, ProfilesState } from "./types";

export const DEFAULT_PROFILE_NAME = "Default";

export function newProfileId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    // fall through to the manual id
  }
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Build the initial collection: the legacy single profile (when present)
 * becomes the one "Default" entry; otherwise an empty Default. */
export function initialProfilesState(legacy: Profile | null): ProfilesState {
  const entry: ProfileEntry = {
    id: newProfileId(),
    name: DEFAULT_PROFILE_NAME,
    moreOf: legacy?.moreOf ?? "",
    lessOf: legacy?.lessOf ?? "",
    updatedAt: legacy?.updatedAt ?? 0,
  };
  return { activeProfileId: entry.id, profiles: [entry] };
}

/** The active entry; falls back to the first entry if activeProfileId is
 * stale (defensive — storage corruption must not crash the app). */
export function activeProfile(state: ProfilesState): ProfileEntry {
  return state.profiles.find((p) => p.id === state.activeProfileId) ?? state.profiles[0]!;
}

/** Write profile fields through to the active entry, preserving id/name. */
export function updateActiveProfile(state: ProfilesState, value: Profile): ProfilesState {
  const active = activeProfile(state);
  return {
    ...state,
    profiles: state.profiles.map((p) =>
      p.id === active.id
        ? { ...p, moreOf: value.moreOf, lessOf: value.lessOf, updatedAt: value.updatedAt }
        : p,
    ),
  };
}

/** Append an empty named profile and make it active. */
export function addProfile(state: ProfilesState, name: string): ProfilesState {
  const entry: ProfileEntry = { id: newProfileId(), name, moreOf: "", lessOf: "", updatedAt: 0 };
  return { activeProfileId: entry.id, profiles: [...state.profiles, entry] };
}

export function renameProfile(state: ProfilesState, id: string, name: string): ProfilesState {
  return { ...state, profiles: state.profiles.map((p) => (p.id === id ? { ...p, name } : p)) };
}

/** Delete an entry. Refuses (returns the same state) for the last remaining
 * profile; reassigns activeProfileId when the active entry is deleted. */
export function deleteProfile(state: ProfilesState, id: string): ProfilesState {
  if (state.profiles.length <= 1) return state;
  const remaining = state.profiles.filter((p) => p.id !== id);
  if (remaining.length === state.profiles.length) return state;
  const activeProfileId =
    state.activeProfileId === id ? remaining[0]!.id : state.activeProfileId;
  return { activeProfileId, profiles: remaining };
}
