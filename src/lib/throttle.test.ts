import { describe, expect, it } from "vitest";
import { throttle } from "./throttle";

/** Injected clock — the throttle is timer-free, so tests need no fake timers. */
function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("throttle", () => {
  it("should run the first call immediately", () => {
    const seen: number[] = [];
    const c = clock();
    const t = throttle((n: number) => seen.push(n), 5000, c.now);

    t.call(1);

    expect(seen).toEqual([1]);
  });

  it("should drop calls inside the interval", () => {
    const seen: number[] = [];
    const c = clock();
    const t = throttle((n: number) => seen.push(n), 5000, c.now);

    t.call(1);
    c.advance(1000);
    t.call(2);
    c.advance(1000);
    t.call(3);

    expect(seen).toEqual([1]);
  });

  it("should run again once the interval has passed, with the newest arguments", () => {
    const seen: number[] = [];
    const c = clock();
    const t = throttle((n: number) => seen.push(n), 5000, c.now);

    t.call(1);
    c.advance(1000);
    t.call(2);
    c.advance(5000);
    t.call(3);

    expect(seen).toEqual([1, 3]);
  });

  it("should flush a pending call regardless of the interval", () => {
    const seen: number[] = [];
    const c = clock();
    const t = throttle((n: number) => seen.push(n), 5000, c.now);

    t.call(1);
    c.advance(100);
    t.call(2);
    t.flush();

    expect(seen).toEqual([1, 2]);
  });

  it("should be a no-op to flush when nothing is pending", () => {
    const seen: number[] = [];
    const c = clock();
    const t = throttle((n: number) => seen.push(n), 5000, c.now);

    t.call(1);
    t.flush();
    t.flush();

    expect(seen).toEqual([1]);
  });

  it("should drop the pending call on cancel", () => {
    const seen: number[] = [];
    const c = clock();
    const t = throttle((n: number) => seen.push(n), 5000, c.now);

    t.call(1);
    c.advance(100);
    t.call(2);
    t.cancel();
    t.flush();

    expect(seen).toEqual([1]);
  });
});
