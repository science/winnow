import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { applyKeyChange, DEFAULT_SETTINGS, isConfigured, missingConfig } from "./settingsStore";
import type { Profile, Settings } from "../lib/types";

const base: Settings = {
  provider: "anthropic",
  anthropicApiKey: null,
  openaiApiKey: null,
  anthropicModel: "claude-haiku-4-5",
  openaiModel: "gpt-5.4-mini",
  scoringStrategy: "two-phase",
};
const emptyProfile: Profile = { moreOf: "", lessOf: "", updatedAt: 0 };
const someProfile: Profile = { moreOf: "deep technical dives", lessOf: "", updatedAt: 1 };

describe("applyKeyChange", () => {
  it("should switch the provider to the key just entered when the selected provider has no key", () => {
    // The Steve scenario: provider defaults to anthropic, user pastes only an OpenAI key.
    const next = applyKeyChange(base, "openai", "sk-openai");
    expect(next.openaiApiKey).toBe("sk-openai");
    expect(next.provider).toBe("openai");
  });

  it("should keep the selected provider when it already has its own key", () => {
    const s: Settings = { ...base, anthropicApiKey: "sk-ant" };
    const next = applyKeyChange(s, "openai", "sk-openai");
    expect(next.provider).toBe("anthropic");
    expect(next.openaiApiKey).toBe("sk-openai");
  });

  it("should switch to the other provider when the selected provider's key is cleared", () => {
    const s: Settings = { ...base, anthropicApiKey: "sk-ant", openaiApiKey: "sk-openai" };
    const next = applyKeyChange(s, "anthropic", null);
    expect(next.anthropicApiKey).toBeNull();
    expect(next.provider).toBe("openai");
  });

  it("should leave the provider alone when a cleared key leaves no keys at all", () => {
    const s: Settings = { ...base, anthropicApiKey: "sk-ant" };
    const next = applyKeyChange(s, "anthropic", null);
    expect(next.provider).toBe("anthropic");
    expect(next.anthropicApiKey).toBeNull();
  });

  it("should not switch away when entering a key for the already-selected provider", () => {
    const next = applyKeyChange(base, "anthropic", "sk-ant");
    expect(next.provider).toBe("anthropic");
    expect(next.anthropicApiKey).toBe("sk-ant");
  });
});

describe("stored-settings migration", () => {
  it("should fill model defaults when loading a pre-model-picker settings blob", () => {
    // Spread-merge over DEFAULT_SETTINGS is the load path in settingsReady.
    const legacy = { provider: "openai" as const, anthropicApiKey: null, openaiApiKey: "sk-openai" };
    const merged: Settings = { ...DEFAULT_SETTINGS, ...legacy };
    expect(merged.anthropicModel).toBe("claude-haiku-4-5");
    expect(merged.openaiModel).toBe("gpt-5.4-mini");
    expect(merged.openaiApiKey).toBe("sk-openai");
  });
});

describe("missingConfig", () => {
  it("should report both key and profile when nothing is set", () => {
    const missing = missingConfig(base, emptyProfile);
    expect(missing).toHaveLength(2);
    expect(missing[0]).toMatch(/api key/i);
    expect(missing[1]).toMatch(/interest profile/i);
  });

  it("should report only the key when the profile has text", () => {
    const missing = missingConfig(base, someProfile);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatch(/api key/i);
  });

  it("should name the selected provider when the other provider has a key", () => {
    // Only reachable by manually radio-clicking to a keyless provider.
    const s: Settings = { ...base, openaiApiKey: "sk-openai" };
    const missing = missingConfig(s, someProfile);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatch(/anthropic/i);
  });

  it("should report only the profile when a key is set", () => {
    const s: Settings = { ...base, anthropicApiKey: "sk-ant" };
    const missing = missingConfig(s, emptyProfile);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatch(/interest profile/i);
  });

  it("should be empty exactly when isConfigured is true", () => {
    const s: Settings = { ...base, anthropicApiKey: "sk-ant" };
    expect(missingConfig(s, someProfile)).toHaveLength(0);
    expect(isConfigured(s, someProfile)).toBe(true);
  });
});

describe("profile proxy store", () => {
  // Fresh module graph per test: the proxy sits over profilesStore's
  // migration-on-init, so each scenario needs its own storage state.
  beforeEach(() => {
    vi.resetModules();
  });

  it("should expose the active profile through the profile store", async () => {
    const storage = await import("../lib/storage");
    await storage.storageSet<Profile>(storage.KEYS.profile, {
      moreOf: "cats",
      lessOf: "dogs",
      updatedAt: 1,
    });
    const { profile, settingsReady } = await import("./settingsStore");
    await settingsReady;
    expect(get(profile).moreOf).toBe("cats");
    expect(get(profile).lessOf).toBe("dogs");
  });

  it("should write profile.update through to the active profiles entry", async () => {
    const storage = await import("../lib/storage");
    const { profile, settingsReady } = await import("./settingsStore");
    await settingsReady;

    profile.update((p) => ({ ...p, moreOf: "trains", updatedAt: 9 }));

    const { profilesState } = await import("./profilesStore");
    const state = get(profilesState);
    const active = state.profiles.find((p) => p.id === state.activeProfileId)!;
    expect(active.moreOf).toBe("trains");
    expect(get(profile).moreOf).toBe("trains");

    // Persisted under the profiles collection, not the legacy key.
    const persisted = await storage.storageGet<{ profiles: { moreOf: string }[] }>(
      storage.KEYS.profiles,
    );
    expect(persisted?.profiles[0]?.moreOf).toBe("trains");
    expect(await storage.storageGet(storage.KEYS.profile)).toBeNull();
  });

  it("should follow the active profile when it changes", async () => {
    const { profile, settingsReady } = await import("./settingsStore");
    await settingsReady;
    profile.update((p) => ({ ...p, moreOf: "default stuff" }));

    const store = await import("./profilesStore");
    await store.addProfileAction("Engineering");
    expect(get(profile).moreOf).toBe("");

    profile.update((p) => ({ ...p, moreOf: "SWE tips" }));
    const state = get(store.profilesState);
    expect(state.profiles.find((p) => p.name === "Default")!.moreOf).toBe("default stuff");
    expect(state.profiles.find((p) => p.name === "Engineering")!.moreOf).toBe("SWE tips");
  });
});
