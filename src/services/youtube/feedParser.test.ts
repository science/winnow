import { describe, it, expect } from "vitest";
import { parseFeedPage } from "./feedParser";
import channelLockup from "./fixtures/channel-videos-lockup.json";
import homeSignedIn from "./fixtures/home-lockup-signedin.json";
import homeSignedOut from "./fixtures/home-signedout.json";
import subsVideoRenderer from "./fixtures/subscriptions-videorenderer.json";

describe("parseFeedPage — legacy videoRenderer shapes (subscriptions)", () => {
  const videos = parseFeedPage(subsVideoRenderer, "subscriptions");

  it("should parse a normal video with full metadata", () => {
    const v = videos.find((v) => v.id === "abc123DEF45");
    expect(v).toBeDefined();
    expect(v!.title).toBe("How Winnowing Works");
    expect(v!.channelTitle).toBe("Grain Channel");
    expect(v!.channelId).toBe("UCgrain12345");
    expect(v!.durationText).toBe("12:34");
    expect(v!.durationSec).toBe(754);
    expect(v!.publishedText).toBe("3 days ago");
    expect(v!.viewCount).toBe(123456);
    expect(v!.thumbnailUrl).toBe("https://i.ytimg.com/vi/abc123DEF45/hqdefault.jpg");
    expect(v!.descriptionSnippet).toBe("A video about separating wheat from chaff.");
    expect(v!.isLive).toBe(false);
    expect(v!.source).toBe("subscriptions");
  });

  it("should mark live streams as live, with watcher count and no duration", () => {
    const v = videos.find((v) => v.id === "live456GHI78");
    expect(v).toBeDefined();
    expect(v!.isLive).toBe(true);
    expect(v!.durationSec).toBeNull();
    expect(v!.viewCount).toBe(1024);
  });

  it("should skip items without a videoId instead of throwing", () => {
    expect(videos.some((v) => v.title.includes("Defective"))).toBe(false);
  });

  it("should skip Shorts and ad slots", () => {
    expect(videos.some((v) => v.id === "shortAAA111")).toBe(false);
    expect(videos).toHaveLength(2);
  });
});

describe("parseFeedPage — modern lockupViewModel shapes", () => {
  it("should parse the real captured channel-videos page", () => {
    const videos = parseFeedPage(channelLockup, "home");
    expect(videos.length).toBe(5);
    for (const v of videos) {
      expect(v.id).toMatch(/^[A-Za-z0-9_-]{11}$/);
      expect(v.title.length).toBeGreaterThan(0);
      expect(v.thumbnailUrl).toContain("i.ytimg.com");
    }
    // Real capture: first item is a known video with duration + views + age.
    const first = videos[0]!;
    expect(first.durationSec).toBeGreaterThan(0);
    expect(first.viewCount).toBeGreaterThan(0);
    expect(first.publishedAtApprox).not.toBeNull();
  });

  it("should parse the signed-in home shape including the channel row", () => {
    const videos = parseFeedPage(homeSignedIn, "home");
    const v = videos.find((v) => v.id === "home789JKL01");
    expect(v).toBeDefined();
    expect(v!.title).toBe("The Recommended Video That Is Actually Good");
    expect(v!.channelTitle).toBe("Quality Channel");
    expect(v!.channelId).toBe("UCquality9876");
    expect(v!.durationText).toBe("23:22");
    expect(v!.viewCount).toBe(2_100_000);
  });

  it("should skip non-video lockups (playlists)", () => {
    const videos = parseFeedPage(homeSignedIn, "home");
    expect(videos.some((v) => v.id === "PLplaylist000")).toBe(false);
    expect(videos).toHaveLength(1);
  });
});

describe("parseFeedPage — robustness", () => {
  it("should return an empty list for a signed-out home page", () => {
    expect(parseFeedPage(homeSignedOut, "home")).toEqual([]);
  });

  it("should return an empty list for junk input instead of throwing", () => {
    expect(parseFeedPage(null, "home")).toEqual([]);
    expect(parseFeedPage(42, "home")).toEqual([]);
    expect(parseFeedPage({ contents: { anything: [] } }, "home")).toEqual([]);
  });

  it("should dedupe repeated videoIds, keeping the first occurrence", () => {
    const dup = {
      items: [
        { videoRenderer: { videoId: "dupdupdup11", title: { runs: [{ text: "First" }] } } },
        { videoRenderer: { videoId: "dupdupdup11", title: { runs: [{ text: "Second" }] } } },
      ],
    };
    const videos = parseFeedPage(dup, "home");
    expect(videos).toHaveLength(1);
    expect(videos[0]!.title).toBe("First");
  });
});
