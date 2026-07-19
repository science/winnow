// Persisted settings + interest profile (wolfechat providerStore pattern:
// init from storage, subscribe → persist). Async storage means consumers
// that need loaded values await `settingsReady` first.

import { writable, type Writable } from "svelte/store";
import type { Profile, Provider, Settings } from "../lib/types";
import { KEYS, storageGet, storageSet } from "../lib/storage";
import { activeProfile, updateActiveProfile } from "../lib/profiles";
import { profilesReady, profilesState } from "./profilesStore";
import { ANTHROPIC_MODEL } from "../services/scoring/anthropicScorer";
import { OPENAI_MODEL } from "../services/scoring/openaiScorer";

// Exported so tests can lock the load-path spread-merge (legacy stored blobs
// without model fields must pick up the defaults).
export const DEFAULT_SETTINGS: Settings = {
  provider: "anthropic",
  anthropicApiKey: null,
  openaiApiKey: null,
  anthropicModel: ANTHROPIC_MODEL,
  openaiModel: OPENAI_MODEL,
  scoringStrategy: "two-phase",
};

export const settings = writable<Settings>(DEFAULT_SETTINGS);

/** The ACTIVE interest profile, proxied over the profiles collection.
 * Same subscribe/set/update contract the old single-profile writable had,
 * so consumers stay collection-unaware. Persistence rides on profilesStore's
 * subscribe — this store must never persist profiles itself (split-brain). */
export const profile: Writable<Profile> = {
  subscribe: (run, invalidate) =>
    profilesState.subscribe((s) => run(activeProfile(s)), invalidate),
  set: (value) => profilesState.update((s) => updateActiveProfile(s, value)),
  update: (fn) => profilesState.update((s) => updateActiveProfile(s, fn(activeProfile(s)))),
};

let persist = false;

export const settingsReady: Promise<void> = (async () => {
  const [storedSettings] = await Promise.all([
    storageGet<Settings>(KEYS.settings),
    profilesReady,
  ]);
  if (storedSettings) settings.set({ ...DEFAULT_SETTINGS, ...storedSettings });
  persist = true;
})();

settings.subscribe((value) => {
  if (persist) void storageSet(KEYS.settings, value);
});

/** True once the user can score: a key for the chosen provider + any profile text. */
export function isConfigured(s: Settings, p: Profile): boolean {
  const key = s.provider === "anthropic" ? s.anthropicApiKey : s.openaiApiKey;
  return Boolean(key) && Boolean(p.moreOf.trim() || p.lessOf.trim());
}

function keyFor(s: Settings, provider: Provider): string | null {
  return provider === "anthropic" ? s.anthropicApiKey : s.openaiApiKey;
}

/** Set one provider's key, and keep `provider` pointing at a provider that
 * actually has a key — entering only an OpenAI key must not leave the app
 * silently unconfigured because the default provider is Anthropic. */
export function applyKeyChange(s: Settings, provider: Provider, key: string | null): Settings {
  const next: Settings =
    provider === "anthropic" ? { ...s, anthropicApiKey: key } : { ...s, openaiApiKey: key };
  if (!keyFor(next, next.provider)) {
    const other: Provider = next.provider === "anthropic" ? "openai" : "anthropic";
    if (keyFor(next, other)) next.provider = other;
  }
  return next;
}

const PROVIDER_LABELS: Record<Provider, string> = { anthropic: "Anthropic", openai: "OpenAI" };

/** Human-readable list of what still blocks the feed; empty iff isConfigured. */
export function missingConfig(s: Settings, p: Profile): string[] {
  const missing: string[] = [];
  if (!keyFor(s, s.provider)) {
    const other: Provider = s.provider === "anthropic" ? "openai" : "anthropic";
    missing.push(
      keyFor(s, other)
        ? `an API key for ${PROVIDER_LABELS[s.provider]} (your selected provider)`
        : "an API key",
    );
  }
  if (!p.moreOf.trim() && !p.lessOf.trim()) {
    missing.push("a few words in your interest profile");
  }
  return missing;
}
