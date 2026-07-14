// Persisted settings + interest profile (wolfechat providerStore pattern:
// init from storage, subscribe → persist). Async storage means consumers
// that need loaded values await `settingsReady` first.

import { writable } from "svelte/store";
import type { Profile, Provider, Settings } from "../lib/types";
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
