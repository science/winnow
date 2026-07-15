import { describe, it, expect } from "vitest";
import { coalesceRuns } from "./singleFlight";

/** A run we can settle from the outside, counting how often it started. */
function controllableRun() {
  const pending: Array<() => void> = [];
  let starts = 0;
  const run = () =>
    new Promise<void>((resolve) => {
      starts += 1;
      pending.push(resolve);
    });
  return { run, finishNext: () => pending.shift()!(), starts: () => starts };
}

const tick = () => new Promise<void>((r) => setTimeout(r));

describe("coalesceRuns", () => {
  it("should share one in-flight run among concurrent callers", async () => {
    const { run, finishNext, starts } = controllableRun();
    const scoreFeed = coalesceRuns(run);
    const a = scoreFeed();
    const b = scoreFeed();
    expect(b).toBe(a);
    expect(starts()).toBe(1);
    finishNext();
    await tick();
    finishNext(); // the coalesced follow-up run
    await a;
    await b;
  });

  it("should queue exactly one follow-up run no matter how many calls land mid-run", async () => {
    const { run, finishNext, starts } = controllableRun();
    const scoreFeed = coalesceRuns(run);
    const first = scoreFeed();
    scoreFeed();
    scoreFeed();
    scoreFeed();
    finishNext();
    await tick();
    expect(starts()).toBe(2); // one live run + one queued rerun, not four
    finishNext();
    await first;
    expect(starts()).toBe(2);
  });

  it("should start a fresh run once the previous one fully settled", async () => {
    const { run, finishNext, starts } = controllableRun();
    const scoreFeed = coalesceRuns(run);
    const first = scoreFeed();
    finishNext();
    await first;
    const second = scoreFeed();
    expect(second).not.toBe(first);
    expect(starts()).toBe(2);
    finishNext();
    await second;
  });

  it("should release the slot when a run rejects, so the next call runs again", async () => {
    let calls = 0;
    const scoreFeed = coalesceRuns(async () => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
    });
    await expect(scoreFeed()).rejects.toThrow("boom");
    await scoreFeed();
    expect(calls).toBe(2);
  });
});
