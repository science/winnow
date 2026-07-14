// Persisted settings + interest profile (wolfechat providerStore pattern:
// init from storage, subscribe → persist). Async storage means consumers
// that need loaded values await `settingsReady` first.

import { writable } from "svelte/store";
import type { Profile, Settings } from "../lib/types";
import { KEYS, storageGet, storageSet } from "../lib/storage";

const DEFAULT_SETTINGS: Settings = {
  provider: "anthropic",
  anthropicApiKey: null,
  openaiApiKey: null,
};

const DEFAULT_PROFILE: Profile = { moreOf: "", lessOf: "", updatedAt: 0 };

export const settings = writable<Settings>(DEFAULT_SETTINGS);
export const profile = writable<Profile>(DEFAULT_PROFILE);

let persist = false;

export const settingsReady: Promise<void> = (async () => {
  const [storedSettings, storedProfile] = await Promise.all([
    storageGet<Settings>(KEYS.settings),
    storageGet<Profile>(KEYS.profile),
  ]);
  if (storedSettings) settings.set({ ...DEFAULT_SETTINGS, ...storedSettings });
  if (storedProfile) profile.set({ ...DEFAULT_PROFILE, ...storedProfile });
  persist = true;
})();

settings.subscribe((value) => {
  if (persist) void storageSet(KEYS.settings, value);
});

profile.subscribe((value) => {
  if (persist) void storageSet(KEYS.profile, value);
});

/** True once the user can score: a key for the chosen provider + any profile text. */
export function isConfigured(s: Settings, p: Profile): boolean {
  const key = s.provider === "anthropic" ? s.anthropicApiKey : s.openaiApiKey;
  return Boolean(key) && Boolean(p.moreOf.trim() || p.lessOf.trim());
}
