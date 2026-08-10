import { describe, expect, it } from "vitest";
import { parsePlayerMessage } from "./playerMessage";

// Shapes captured from the real player during the extension-tier gate
// (e2e/extension/playerTelemetry.test.mjs): the embed posts JSON *strings*.
const infoDelivery = (info: Record<string, unknown>): string =>
  JSON.stringify({ event: "infoDelivery", id: 1, channel: "widget", info });

describe("parsePlayerMessage", () => {
  it("should read currentTime and duration from an infoDelivery message", () => {
    expect(parsePlayerMessage(infoDelivery({ currentTime: 12.5, duration: 600 }))).toEqual({
      positionSec: 12.5,
      durationSec: 600,
      ended: false,
    });
  });

  it("should accept the already-parsed object form", () => {
    expect(
      parsePlayerMessage({ event: "infoDelivery", info: { currentTime: 3, duration: 60 } }),
    ).toEqual({ positionSec: 3, durationSec: 60, ended: false });
  });

  it("should report the ended state from playerState 0", () => {
    const parsed = parsePlayerMessage(
      infoDelivery({ currentTime: 599, duration: 600, playerState: 0 }),
    );
    expect(parsed?.ended).toBe(true);
  });

  it("should ignore onReady and other event types", () => {
    expect(parsePlayerMessage(JSON.stringify({ event: "onReady", info: {} }))).toBeNull();
    expect(parsePlayerMessage(JSON.stringify({ event: "initialDelivery", info: {} }))).toBeNull();
  });

  it("should ignore anything malformed rather than throwing", () => {
    // Same discipline as feedParser: a surprising shape is a skip, not a crash.
    for (const bad of ["not json at all", "", null, undefined, 42, { event: "infoDelivery" }]) {
      expect(parsePlayerMessage(bad)).toBeNull();
    }
  });

  it("should ignore an infoDelivery whose currentTime is not a number", () => {
    expect(parsePlayerMessage(infoDelivery({ currentTime: "12", duration: 600 }))).toBeNull();
    expect(parsePlayerMessage(infoDelivery({ duration: 600 }))).toBeNull();
  });
});
