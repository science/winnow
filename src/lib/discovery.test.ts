import { describe, expect, it } from "vitest";
import {
  buildQueryPool,
  markQueriesUsed,
  pickQueries,
  QUERIES_PER_RUN,
  QUERY_POOL_MAX,
} from "./discovery";

describe("buildQueryPool", () => {
  it("should trim, dedupe case-insensitively, and cap the pool", () => {
    const raw = [
      "  kpop stage mix  ",
      "Kpop Stage Mix",
      "",
      ...Array.from({ length: 20 }, (_unused, i) => `query ${i}`),
    ];
    const pool = buildQueryPool(raw);
    expect(pool.length).toBe(QUERY_POOL_MAX);
    expect(pool[0]).toEqual({ text: "kpop stage mix", lastUsedAt: 0 });
    expect(pool.filter((q) => q.text.toLowerCase() === "kpop stage mix")).toHaveLength(1);
  });
});

describe("pickQueries", () => {
  it("should pick never-used queries first, then the least recently used", () => {
    const pool = [
      { text: "used recently", lastUsedAt: 300 },
      { text: "never used a", lastUsedAt: 0 },
      { text: "used long ago", lastUsedAt: 100 },
      { text: "never used b", lastUsedAt: 0 },
    ];
    expect(pickQueries(pool, 3)).toEqual(["never used a", "never used b", "used long ago"]);
  });

  it("should return at most n queries and default to QUERIES_PER_RUN", () => {
    const pool = Array.from({ length: 12 }, (_unused, i) => ({ text: `q${i}`, lastUsedAt: 0 }));
    expect(pickQueries(pool)).toHaveLength(QUERIES_PER_RUN);
    expect(pickQueries(pool, 3)).toHaveLength(3);
    expect(pickQueries(pool.slice(0, 2), 5)).toHaveLength(2);
  });
});

describe("markQueriesUsed", () => {
  it("should stamp lastUsedAt only on the used queries", () => {
    const pool = [
      { text: "a", lastUsedAt: 0 },
      { text: "b", lastUsedAt: 0 },
    ];
    const next = markQueriesUsed(pool, ["a"], 500);
    expect(next).toEqual([
      { text: "a", lastUsedAt: 500 },
      { text: "b", lastUsedAt: 0 },
    ]);
  });
});
