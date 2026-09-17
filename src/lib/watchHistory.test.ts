import { describe, it, expect } from "vitest";
import {
  HISTORY_MIN_WATCH_SEC,
  creditWatch,
  generateCpn,
  historyThresholdSec,
  playbackPingUrl,
} from "./watchHistory";

const BASE =
  "https://s.youtube.com/api/stats/playback?cl=1&docid=abc&ei=xyz&el=detailpage&len=213&of=o&vm=v";

describe("generateCpn", () => {
  it("should produce 16 characters from YouTube's cpn alphabet", () => {
    const cpn = generateCpn(new Uint8Array(16).map((_, i) => i * 17));
    expect(cpn).toHaveLength(16);
    expect(cpn).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });

  it("should map each byte by its low six bits", () => {
    expect(generateCpn(new Uint8Array([0, 25, 26, 51, 52, 62, 63, 64]))).toBe("azAZ0-_a");
  });
});

describe("playbackPingUrl", () => {
  const url = new URL(playbackPingUrl(BASE, "CPNCPNCPNCPNCPN0"));

  it("should keep the watch page's tracking parameters", () => {
    expect(`${url.origin}${url.pathname}`).toBe("https://s.youtube.com/api/stats/playback");
    for (const key of ["cl", "docid", "ei", "len", "of", "vm"]) {
      expect(url.searchParams.get(key)).toBe(new URL(BASE).searchParams.get(key));
    }
  });

  it("should report a desktop watch-page play starting at zero", () => {
    expect(url.searchParams.get("ver")).toBe("2");
    expect(url.searchParams.get("cpn")).toBe("CPNCPNCPNCPNCPN0");
    expect(url.searchParams.get("cmt")).toBe("0");
    expect(url.searchParams.get("el")).toBe("detailpage");
  });

  it("should override an el that is not detailpage", () => {
    const shorts = playbackPingUrl(BASE.replace("el=detailpage", "el=shortspage"), "c");
    expect(new URL(shorts).searchParams.getAll("el")).toEqual(["detailpage"]);
  });

  it("should refuse a tracking URL that is not YouTube's stats endpoint", () => {
    expect(() => playbackPingUrl("https://evil.example/api/stats/playback?x=1", "c")).toThrow();
    expect(() => playbackPingUrl("https://s.youtube.com/api/stats/delete?x=1", "c")).toThrow();
    expect(() => playbackPingUrl("http://s.youtube.com/api/stats/playback?x=1", "c")).toThrow();
  });
});

describe("creditWatch", () => {
  const start = creditWatch(undefined, { positionSec: 12, at: 1000 });

  it("should take the first sample as a baseline without crediting it", () => {
    expect(start).toEqual({ watchedSec: 0, lastPositionSec: 12, lastAt: 1000 });
  });

  it("should credit playback that advances with the clock", () => {
    const next = creditWatch(start, { positionSec: 12.5, at: 1500 });
    expect(next.watchedSec).toBeCloseTo(0.5);
    expect(creditWatch(next, { positionSec: 13, at: 2000 }).watchedSec).toBeCloseTo(1);
  });

  it("should credit a gap between samples when playback kept pace (a throttled background tab)", () => {
    expect(creditWatch(start, { positionSec: 42, at: 31_000 }).watchedSec).toBeCloseTo(30);
  });

  it("should allow double-speed playback", () => {
    expect(creditWatch(start, { positionSec: 22, at: 6000 }).watchedSec).toBeCloseTo(10);
  });

  it("should not credit a seek forward", () => {
    const seeked = creditWatch(start, { positionSec: 300, at: 1500 });
    expect(seeked.watchedSec).toBe(0);
    expect(seeked.lastPositionSec).toBe(300);
    expect(creditWatch(seeked, { positionSec: 300.5, at: 2000 }).watchedSec).toBeCloseTo(0.5);
  });

  it("should not credit a seek backward or a paused player", () => {
    expect(creditWatch(start, { positionSec: 0, at: 1500 }).watchedSec).toBe(0);
    expect(creditWatch(start, { positionSec: 12, at: 60_000 }).watchedSec).toBe(0);
  });

  it("should ignore samples with a bad position", () => {
    expect(creditWatch(start, { positionSec: Number.NaN, at: 1500 })).toBe(start);
  });
});

describe("historyThresholdSec", () => {
  it("should ask for HISTORY_MIN_WATCH_SEC of a long video", () => {
    expect(historyThresholdSec(3600)).toBe(HISTORY_MIN_WATCH_SEC);
  });

  it("should ask for half of a video shorter than twice the minimum", () => {
    expect(historyThresholdSec(20)).toBe(10);
  });

  it("should fall back to the minimum while the duration is unknown", () => {
    expect(historyThresholdSec(0)).toBe(HISTORY_MIN_WATCH_SEC);
  });
});
