import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import type { Profile } from "../lib/types";

// Each test gets a fresh module graph (and thus a fresh in-memory storage
// fallback) so init-time migration can be exercised per scenario.
beforeEach(() => {
  vi.resetModules();
});

type StorageModule = typeof import("../lib/storage");
type ProfilesStoreModule = typeof import("./profilesStore");

async function loadStorage(): Promise<StorageModule> {
  return import("../lib/storage");
}

async function loadStore(): Promise<ProfilesStoreModule> {
  const store = await import("./profilesStore");
  await store.profilesReady;
  return store;
}

describe("profilesStore init", () => {
  it("should migrate a legacy profile into a persisted Default profiles state", async () => {
    const storage = await loadStorage();
    const legacy: Profile = { moreOf: "cats", lessOf: "dogs", updatedAt: 5 };
    await storage.storageSet(storage.KEYS.profile, legacy);

    const store = await loadStore();
    const state = get(store.profilesState);
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0]!.name).toBe("Default");
    expect(state.profiles[0]!.moreOf).toBe("cats");
    expect(state.activeProfileId).toBe(state.profiles[0]!.id);

    const persisted = await storage.storageGet<{ profiles: unknown[] }>(storage.KEYS.profiles);
    expect(persisted?.profiles).toHaveLength(1);
    // The legacy blob stays in place as rollback safety.
    expect(await storage.storageGet<Profile>(storage.KEYS.profile)).toEqual(legacy);
  });

  it("should load an existing profiles state without re-running migration", async () => {
    const storage = await loadStorage();
    await storage.storageSet(storage.KEYS.profile, { moreOf: "stale", lessOf: "", updatedAt: 1 });
    await storage.storageSet(storage.KEYS.profiles, {
      activeProfileId: "p2",
      profiles: [
        { id: "p1", name: "Leisure", moreOf: "kpop", lessOf: "", updatedAt: 2 },
        { id: "p2", name: "Engineering", moreOf: "SWE tips", lessOf: "dance", updatedAt: 3 },
      ],
    });

    const store = await loadStore();
    const state = get(store.profilesState);
    expect(state.profiles).toHaveLength(2);
    expect(state.activeProfileId).toBe("p2");
    expect(state.profiles[0]!.moreOf).toBe("kpop");
  });

  it("should start with an empty Default profile when nothing is stored", async () => {
    const store = await loadStore();
    const state = get(store.profilesState);
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0]!.name).toBe("Default");
    expect(state.profiles[0]!.moreOf).toBe("");
  });
});

describe("profile actions", () => {
  it("should persist added and renamed profiles", async () => {
    const storage = await loadStorage();
    const store = await loadStore();

    const newId = await store.addProfileAction("Kpop fun");
    await store.renameProfileAction(newId, "Kpop nights");

    const state = get(store.profilesState);
    expect(state.activeProfileId).toBe(newId);
    expect(state.profiles.map((p) => p.name)).toEqual(["Default", "Kpop nights"]);

    const persisted = await storage.storageGet<{
      activeProfileId: string;
      profiles: { name: string }[];
    }>(storage.KEYS.profiles);
    expect(persisted?.activeProfileId).toBe(newId);
    expect(persisted?.profiles.map((p) => p.name)).toEqual(["Default", "Kpop nights"]);
  });

  it("should remove the deleted profile's per-profile storage keys", async () => {
    const storage = await loadStorage();
    const store = await loadStore();

    const doomedId = await store.addProfileAction("Doomed");
    const keys = storage.profileKeys(doomedId);
    for (const key of Object.values(keys)) {
      await storage.storageSet(key, { some: "data" });
    }

    const deleted = await store.deleteProfileAction(doomedId);
    expect(deleted).toBe(true);
    for (const key of Object.values(keys)) {
      expect(await storage.storageGet(key)).toBeNull();
    }
    const state = get(store.profilesState);
    expect(state.profiles.map((p) => p.name)).toEqual(["Default"]);
    expect(state.activeProfileId).toBe(state.profiles[0]!.id);
  });

  it("should refuse to delete the last profile", async () => {
    const store = await loadStore();
    const onlyId = get(store.profilesState).profiles[0]!.id;
    const deleted = await store.deleteProfileAction(onlyId);
    expect(deleted).toBe(false);
    expect(get(store.profilesState).profiles).toHaveLength(1);
  });
});
