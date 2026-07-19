import { describe, expect, it } from "vitest";
import type { Profile } from "./types";
import {
  activeProfile,
  addProfile,
  deleteProfile,
  initialProfilesState,
  renameProfile,
  updateActiveProfile,
} from "./profiles";

const legacy: Profile = { moreOf: "deep technical dives", lessOf: "drama", updatedAt: 42 };

describe("initialProfilesState", () => {
  it("should migrate a legacy profile into a single active Default entry", () => {
    const state = initialProfilesState(legacy);
    expect(state.profiles).toHaveLength(1);
    const entry = state.profiles[0]!;
    expect(entry.name).toBe("Default");
    expect(entry.moreOf).toBe("deep technical dives");
    expect(entry.lessOf).toBe("drama");
    expect(entry.updatedAt).toBe(42);
    expect(state.activeProfileId).toBe(entry.id);
  });

  it("should create an empty Default profile when no legacy profile exists", () => {
    const state = initialProfilesState(null);
    expect(state.profiles).toHaveLength(1);
    const entry = state.profiles[0]!;
    expect(entry.name).toBe("Default");
    expect(entry.moreOf).toBe("");
    expect(entry.lessOf).toBe("");
    expect(state.activeProfileId).toBe(entry.id);
  });

  it("should mint distinct profile ids across calls", () => {
    const a = initialProfilesState(null);
    const b = initialProfilesState(null);
    expect(a.profiles[0]!.id).not.toBe(b.profiles[0]!.id);
  });
});

describe("activeProfile", () => {
  it("should return the entry matching activeProfileId", () => {
    const state = addProfile(initialProfilesState(legacy), "Engineering");
    expect(activeProfile(state).name).toBe("Engineering");
  });

  it("should fall back to the first entry when activeProfileId is unknown", () => {
    const state = { ...initialProfilesState(legacy), activeProfileId: "gone" };
    expect(activeProfile(state).name).toBe("Default");
  });
});

describe("updateActiveProfile", () => {
  it("should write profile fields through to the active entry, preserving id and name", () => {
    const state = initialProfilesState(legacy);
    const before = state.profiles[0]!;
    const next = updateActiveProfile(state, { moreOf: "kpop", lessOf: "serious stuff", updatedAt: 99 });
    const entry = next.profiles[0]!;
    expect(entry.id).toBe(before.id);
    expect(entry.name).toBe("Default");
    expect(entry.moreOf).toBe("kpop");
    expect(entry.lessOf).toBe("serious stuff");
    expect(entry.updatedAt).toBe(99);
  });

  it("should not touch other entries when updating the active one", () => {
    const state = addProfile(initialProfilesState(legacy), "Engineering");
    const next = updateActiveProfile(state, { moreOf: "SWE tips", lessOf: "dance", updatedAt: 7 });
    const untouched = next.profiles.find((p) => p.name === "Default")!;
    expect(untouched.moreOf).toBe("deep technical dives");
    const updated = next.profiles.find((p) => p.name === "Engineering")!;
    expect(updated.moreOf).toBe("SWE tips");
  });
});

describe("addProfile", () => {
  it("should append an empty named profile and make it active", () => {
    const base = initialProfilesState(legacy);
    const next = addProfile(base, "Kpop fun");
    expect(next.profiles).toHaveLength(2);
    const added = next.profiles[1]!;
    expect(added.name).toBe("Kpop fun");
    expect(added.moreOf).toBe("");
    expect(added.lessOf).toBe("");
    expect(next.activeProfileId).toBe(added.id);
    expect(next.profiles[0]).toEqual(base.profiles[0]);
  });
});

describe("renameProfile", () => {
  it("should rename only the targeted profile", () => {
    const state = addProfile(initialProfilesState(legacy), "Engineering");
    const targetId = state.profiles[0]!.id;
    const next = renameProfile(state, targetId, "Leisure");
    expect(next.profiles[0]!.name).toBe("Leisure");
    expect(next.profiles[1]!.name).toBe("Engineering");
  });
});

describe("deleteProfile", () => {
  it("should refuse to delete the last remaining profile", () => {
    const state = initialProfilesState(legacy);
    expect(deleteProfile(state, state.profiles[0]!.id)).toBe(state);
  });

  it("should reassign activeProfileId when the active profile is deleted", () => {
    const state = addProfile(initialProfilesState(legacy), "Engineering");
    const next = deleteProfile(state, state.activeProfileId);
    expect(next.profiles).toHaveLength(1);
    expect(next.activeProfileId).toBe(next.profiles[0]!.id);
    expect(next.profiles[0]!.name).toBe("Default");
  });

  it("should keep the active profile when deleting another entry", () => {
    const state = addProfile(initialProfilesState(legacy), "Engineering");
    const defaultId = state.profiles[0]!.id;
    const next = deleteProfile(state, defaultId);
    expect(next.profiles).toHaveLength(1);
    expect(next.activeProfileId).toBe(state.activeProfileId);
    expect(activeProfile(next).name).toBe("Engineering");
  });
});
