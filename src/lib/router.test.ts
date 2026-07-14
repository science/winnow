import { describe, it, expect } from "vitest";
import { parseHash } from "./router";

describe("parseHash", () => {
  it("should route empty and root hashes to the feed", () => {
    expect(parseHash("")).toEqual({ name: "feed" });
    expect(parseHash("#/")).toEqual({ name: "feed" });
    expect(parseHash("#")).toEqual({ name: "feed" });
  });

  it("should route #/watch/<id> to the watch view with the video id", () => {
    expect(parseHash("#/watch/dQw4w9WgXcQ")).toEqual({
      name: "watch",
      videoId: "dQw4w9WgXcQ",
    });
  });

  it("should route #/settings to settings", () => {
    expect(parseHash("#/settings")).toEqual({ name: "settings" });
  });

  it("should fall back to the feed for unknown or malformed routes", () => {
    expect(parseHash("#/watch/")).toEqual({ name: "feed" });
    expect(parseHash("#/bogus")).toEqual({ name: "feed" });
    expect(parseHash("#/watch/../../etc")).toEqual({ name: "feed" });
  });
});
