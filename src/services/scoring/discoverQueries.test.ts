import { describe, expect, it, vi } from "vitest";
import type { Profile } from "../../lib/types";
import { profileKeys, storageGet, storageSet } from "../../lib/storage";
import {
  buildQueriesMessage,
  demoQueryTexts,
  ensureQueryPool,
  queryPoolInputHashFor,
  QUERY_PROMPT_VERSION,
  type StoredQueryPool,
} from "./discoverQueries";
import { canonicalizeTarget } from "../../lib/rubricScorer";
import type { StructuredCallFn } from "./twoPhase";

const profile: Profile = {
  moreOf: "hand-tool woodworking, deep engineering dives",
  lessOf: "drama, reaction content",
  updatedAt: 1,
};

const target = canonicalizeTarget({
  fields: {},
  topicsMore: { items: ["woodworking:hand-tool"], importance: 8 },
  topicsLess: { items: ["drama"], importance: 6 },
  formatsAvoid: { items: [], importance: 0 },
  tonesAvoid: { items: [], importance: 0 },
});

function callFnReturning(queries: string[]) {
  return vi.fn(async () => ({ queries })) as unknown as StructuredCallFn &
    ReturnType<typeof vi.fn>;
}

describe("buildQueriesMessage", () => {
  it("should include the profile's yes/no text and the translated target topics", () => {
    const msg = buildQueriesMessage(profile, target);
    expect(msg).toContain("hand-tool woodworking");
    expect(msg).toContain("drama, reaction content");
    expect(msg).toContain("woodworking:hand-tool");
  });

  it("should build a usable message when no translated target exists yet", () => {
    const msg = buildQueriesMessage(profile, null);
    expect(msg).toContain("hand-tool woodworking");
  });
});

describe("queryPoolInputHashFor", () => {
  it("should change when the profile text, prompt version, or model changes", () => {
    const base = queryPoolInputHashFor(profile, "model-a");
    expect(queryPoolInputHashFor({ ...profile, moreOf: "other" }, "model-a")).not.toBe(base);
    expect(queryPoolInputHashFor(profile, "model-b")).not.toBe(base);
    expect(queryPoolInputHashFor(profile, "model-a")).toBe(base);
    expect(QUERY_PROMPT_VERSION).toBeGreaterThanOrEqual(1);
  });
});

describe("ensureQueryPool", () => {
  const baseOpts = {
    profileId: "ptest",
    profile,
    provider: "anthropic" as const,
    apiKey: "sk-test",
    model: "model-a",
    demo: false,
  };

  it("should generate, clamp, and persist a pool on first run", async () => {
    const callFn = callFnReturning(Array.from({ length: 20 }, (_u, i) => `query ${i}`));
    const pool = await ensureQueryPool({ ...baseOpts, profileId: "pfresh", callFn });
    expect(callFn).toHaveBeenCalledTimes(1);
    expect(pool.queries.length).toBeLessThanOrEqual(12);
    expect(pool.inputHash).toBe(queryPoolInputHashFor(profile, "model-a"));
    const stored = await storageGet<StoredQueryPool>(profileKeys("pfresh").discoverQueries);
    expect(stored).toEqual(pool);
  });

  it("should reuse the cached pool without a provider call while the hash matches", async () => {
    const seeded: StoredQueryPool = {
      inputHash: queryPoolInputHashFor(profile, "model-a"),
      queries: [{ text: "cached query", lastUsedAt: 42 }],
    };
    await storageSet(profileKeys("pcached").discoverQueries, seeded);
    const callFn = callFnReturning(["should not be used"]);
    const pool = await ensureQueryPool({ ...baseOpts, profileId: "pcached", callFn });
    expect(callFn).not.toHaveBeenCalled();
    expect(pool).toEqual(seeded);
  });

  it("should regenerate when the profile text changed the hash", async () => {
    const stale: StoredQueryPool = {
      inputHash: queryPoolInputHashFor({ ...profile, moreOf: "old interests" }, "model-a"),
      queries: [{ text: "stale query", lastUsedAt: 42 }],
    };
    await storageSet(profileKeys("pstale").discoverQueries, stale);
    const callFn = callFnReturning(["fresh query"]);
    const pool = await ensureQueryPool({ ...baseOpts, profileId: "pstale", callFn });
    expect(callFn).toHaveBeenCalledTimes(1);
    expect(pool.queries.map((q) => q.text)).toEqual(["fresh query"]);
  });

  it("should regenerate on force even when the cached pool is current", async () => {
    const seeded: StoredQueryPool = {
      inputHash: queryPoolInputHashFor(profile, "model-a"),
      queries: [{ text: "cached query", lastUsedAt: 42 }],
    };
    await storageSet(profileKeys("pforce").discoverQueries, seeded);
    const callFn = callFnReturning(["regenerated query"]);
    const pool = await ensureQueryPool({ ...baseOpts, profileId: "pforce", callFn, force: true });
    expect(callFn).toHaveBeenCalledTimes(1);
    expect(pool.queries.map((q) => q.text)).toEqual(["regenerated query"]);
  });

  it("should build a deterministic demo pool without any provider call", async () => {
    const callFn = callFnReturning(["should not be used"]);
    const pool = await ensureQueryPool({ ...baseOpts, profileId: "pdemo", demo: true, callFn });
    expect(callFn).not.toHaveBeenCalled();
    expect(pool.queries.length).toBeGreaterThan(0);
    expect(pool.queries.map((q) => q.text)).toEqual(demoQueryTexts(profile));
  });
});
