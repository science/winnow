import { describe, expect, it, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  PERSIST_INTERVAL_MS,
  flushPositions,
  playbackReady,
  positions,
  recordPosition,
  resumeStartFor,
} from "./playbackStore";
import { KEYS, storageGet, storageSet } from "../lib/storage";
import type { PlaybackPosition } from "../lib/playbackPosition";

const VIDEO = "playbackvid";

async function stored(): Promise<Record<string, PlaybackPosition> | null> {
  return storageGet<Record<string, PlaybackPosition>>(KEYS.playback);
}

describe("playbackStore", () => {
  beforeEach(async () => {
    await playbackReady;
    positions.set({});
    await storageSet(KEYS.playback, {});
  });

  it("should keep the position in memory without writing on every sample", async () => {
    let clock = 1_000_000;
    recordPosition(VIDEO, { positionSec: 30, durationSec: 600, ended: false }, () => clock);
    clock += 500;
    recordPosition(VIDEO, { positionSec: 31, durationSec: 600, ended: false }, () => clock);

    expect(get(positions)[VIDEO]?.positionSec).toBe(31);
    // The first sample writes through; the second is inside the interval.
    expect((await stored())?.[VIDEO]?.positionSec).toBe(30);
  });

  it("should persist again once the interval has passed", async () => {
    let clock = 1_000_000;
    recordPosition(VIDEO, { positionSec: 30, durationSec: 600, ended: false }, () => clock);
    clock += PERSIST_INTERVAL_MS;
    recordPosition(VIDEO, { positionSec: 40, durationSec: 600, ended: false }, () => clock);

    expect((await stored())?.[VIDEO]?.positionSec).toBe(40);
  });

  it("should persist immediately on flush", async () => {
    let clock = 1_000_000;
    recordPosition(VIDEO, { positionSec: 30, durationSec: 600, ended: false }, () => clock);
    clock += 500;
    recordPosition(VIDEO, { positionSec: 44, durationSec: 600, ended: false }, () => clock);

    await flushPositions();

    expect((await stored())?.[VIDEO]?.positionSec).toBe(44);
  });

  it("should forget the position once the video finishes", async () => {
    let clock = 1_000_000;
    recordPosition(VIDEO, { positionSec: 300, durationSec: 600, ended: false }, () => clock);
    clock += PERSIST_INTERVAL_MS;
    recordPosition(VIDEO, { positionSec: 599, durationSec: 600, ended: true }, () => clock);

    expect(get(positions)[VIDEO]).toBeUndefined();
    expect((await stored())?.[VIDEO]).toBeUndefined();
  });

  it("should resume from a stored position", () => {
    positions.set({ [VIDEO]: { positionSec: 754.9, durationSec: 3600, updatedAt: 1 } });
    expect(resumeStartFor(VIDEO)).toBe(754);
  });

  it("should start from the beginning when nothing is stored", () => {
    expect(resumeStartFor("neverwatched")).toBe(0);
  });
});
