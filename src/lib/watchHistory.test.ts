import { describe, it, expect } from "vitest";
import { generateCpn, playbackPingUrl } from "./watchHistory";

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
