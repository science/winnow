import { describe, it, expect } from "vitest";
import { fnv1a, profileHash } from "./profileHash";
import type { Profile } from "./types";

const profile: Profile = { moreOf: "deep dives", lessOf: "drama", updatedAt: 0 };

describe("fnv1a", () => {
  it("should be deterministic and 8 hex chars", () => {
    expect(fnv1a("hello")).toBe(fnv1a("hello"));
    expect(fnv1a("hello")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("should differ for different inputs", () => {
    expect(fnv1a("hello")).not.toBe(fnv1a("hello!"));
  });
});

describe("profileHash", () => {
  it("should change when any input changes", () => {
    const base = profileHash(profile, 1, "model-a");
    expect(profileHash({ ...profile, moreOf: "x" }, 1, "model-a")).not.toBe(base);
    expect(profileHash({ ...profile, lessOf: "x" }, 1, "model-a")).not.toBe(base);
    expect(profileHash(profile, 2, "model-a")).not.toBe(base);
    expect(profileHash(profile, 1, "model-b")).not.toBe(base);
  });

  it("should not collide on field-boundary shifts", () => {
    const a = profileHash({ moreOf: "ab", lessOf: "c", updatedAt: 0 }, 1, "m");
    const b = profileHash({ moreOf: "a", lessOf: "bc", updatedAt: 0 }, 1, "m");
    expect(a).not.toBe(b);
  });

  it("should ignore updatedAt (content-addressed, not time-addressed)", () => {
    expect(profileHash({ ...profile, updatedAt: 99 }, 1, "m")).toBe(
      profileHash({ ...profile, updatedAt: 1 }, 1, "m"),
    );
  });
});
