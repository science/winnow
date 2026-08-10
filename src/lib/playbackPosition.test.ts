import { describe, expect, it } from "vitest";
import {
  isFinished,
  POSITIONS_CAP,
  prunePositions,
  resumeStartSec,
  updatePositions,
  type PlaybackPosition,
} from "./playbackPosition";

const entry = (positionSec: number, durationSec = 600, updatedAt = 1): PlaybackPosition => ({
  positionSec,
  durationSec,
  updatedAt,
});

describe("resumeStartSec", () => {
  it("should start from the beginning when nothing is stored", () => {
    expect(resumeStartSec(null)).toBe(0);
  });

  it("should not resume a video the user barely started", () => {
    expect(resumeStartSec(entry(9))).toBe(0);
  });

  it("should resume mid-video at a whole second", () => {
    expect(resumeStartSec(entry(754.83, 3600))).toBe(754);
  });

  it("should not resume a video that is effectively finished", () => {
    expect(resumeStartSec(entry(592, 600))).toBe(0);
  });

  it("should clamp a stored position that exceeds the duration", () => {
    // A duration that shrank (a re-upload, a bad sample) must not seek past
    // the end, which YouTube answers by restarting anyway.
    expect(resumeStartSec(entry(900, 300))).toBe(0);
  });
});

describe("isFinished", () => {
  it("should treat the last few seconds as finished", () => {
    expect(isFinished(590, 600)).toBe(true);
    expect(isFinished(400, 600)).toBe(false);
  });

  it("should not call anything finished without a known duration", () => {
    expect(isFinished(100, 0)).toBe(false);
  });
});

describe("updatePositions", () => {
  it("should record a position for a video", () => {
    const next = updatePositions({}, "videoaaaaaa", { positionSec: 120, durationSec: 600, at: 5 });
    expect(next["videoaaaaaa"]).toEqual({ positionSec: 120, durationSec: 600, updatedAt: 5 });
  });

  it("should clear the entry when playback reaches the end", () => {
    const map = { videoaaaaaa: entry(300) };
    const next = updatePositions(map, "videoaaaaaa", { positionSec: 599, durationSec: 600, at: 9 });
    expect(next["videoaaaaaa"]).toBeUndefined();
  });

  it("should ignore a nonsense currentTime from the player", () => {
    const map = { videoaaaaaa: entry(300) };
    for (const bad of [NaN, -5, Infinity]) {
      expect(updatePositions(map, "videoaaaaaa", { positionSec: bad, durationSec: 600, at: 9 })).toBe(map);
    }
  });

  it("should carry the last known duration when a sample omits it", () => {
    // The player sends the full state once and then partial updates that
    // carry currentTime alone — rejecting those froze the stored position at
    // the first sample (caught by the extension-tier round-trip, 2026-08-09).
    const map = { videoaaaaaa: entry(300, 600) };
    const next = updatePositions(map, "videoaaaaaa", { positionSec: 310, durationSec: 0, at: 9 });
    expect(next["videoaaaaaa"]).toEqual({ positionSec: 310, durationSec: 600, updatedAt: 9 });
  });

  it("should still record a position for a video whose duration is unknown", () => {
    const next = updatePositions({}, "videoaaaaaa", { positionSec: 42, durationSec: 0, at: 9 });
    expect(next["videoaaaaaa"]).toEqual({ positionSec: 42, durationSec: 0, updatedAt: 9 });
  });

  it("should evict the oldest entry past the cap", () => {
    let map: Record<string, PlaybackPosition> = {};
    for (let i = 0; i < POSITIONS_CAP; i++) {
      map = updatePositions(map, `video${i}`, { positionSec: 100, durationSec: 600, at: i + 1 });
    }
    map = updatePositions(map, "newestvideo", {
      positionSec: 100,
      durationSec: 600,
      at: POSITIONS_CAP + 1,
    });

    expect(Object.keys(map)).toHaveLength(POSITIONS_CAP);
    expect(map["video0"]).toBeUndefined();
    expect(map["newestvideo"]).toBeDefined();
  });
});

describe("prunePositions", () => {
  it("should drop positions for videos outside the feed window", () => {
    const map = { staysinwindow: entry(100), leftthewindow: entry(200) };
    expect(prunePositions(map, new Set(["staysinwindow"]))).toEqual({ staysinwindow: entry(100) });
  });
});
