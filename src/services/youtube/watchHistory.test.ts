import { afterEach, describe, it, expect, vi } from "vitest";
import { extractPlaybackTrackingUrl, recordWatch } from "./watchHistory";

const TRACKING = "https://s.youtube.com/api/stats/playback?cl=1&docid=vid12345678&el=detailpage&len=60";

function watchHtml(playerResponse: unknown): string {
  return `<html><script>var ytInitialPlayerResponse = ${JSON.stringify(playerResponse)};var meta = {};</script></html>`;
}

const PAGE = watchHtml({
  videoDetails: { videoId: "vid12345678", title: "has }; inside" },
  playbackTracking: { videostatsPlaybackUrl: { baseUrl: TRACKING } },
});

function stubFetch(pageHtml: string, pingStatus = 204) {
  return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://www.youtube.com/watch")) return new Response(pageHtml, { status: 200 });
    return new Response(null, { status: pingStatus });
  });
}

describe("extractPlaybackTrackingUrl", () => {
  it("should read the playback tracking URL from the player response", () => {
    expect(extractPlaybackTrackingUrl(PAGE)).toBe(TRACKING);
  });

  it("should return null when the page has no usable tracking URL", () => {
    expect(extractPlaybackTrackingUrl("<html>consent wall</html>")).toBeNull();
    expect(extractPlaybackTrackingUrl(watchHtml({ playbackTracking: {} }))).toBeNull();
    expect(extractPlaybackTrackingUrl(watchHtml({ playbackTracking: { videostatsPlaybackUrl: { baseUrl: 7 } } }))).toBeNull();
  });
});

describe("recordWatch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should fetch the watch page and send one credentialed playback ping", async () => {
    const fetchFn = stubFetch(PAGE);
    expect(await recordWatch("vid12345678", { fetchFn })).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const [pageCall, pingCall] = fetchFn.mock.calls;
    expect(String(pageCall![0])).toBe("https://www.youtube.com/watch?v=vid12345678");
    expect(pageCall![1]).toMatchObject({ credentials: "include" });
    const ping = new URL(String(pingCall![0]));
    expect(ping.pathname).toBe("/api/stats/playback");
    expect(ping.searchParams.get("cpn")).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(pingCall![1]).toMatchObject({ credentials: "include" });
  });

  it("should send no ping when the page has no tracking URL", async () => {
    const fetchFn = stubFetch("<html>consent wall</html>");
    expect(await recordWatch("vid12345678", { fetchFn })).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("should report failure without throwing when YouTube rejects the ping", async () => {
    expect(await recordWatch("vid12345678", { fetchFn: stubFetch(PAGE, 403) })).toBe(false);
  });

  it("should report failure without throwing on a network error", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("NetworkError");
    });
    expect(await recordWatch("vid12345678", { fetchFn })).toBe(false);
  });

  it("should never touch the network in demo mode", async () => {
    vi.stubGlobal("location", new URL("moz-extension://x/feed.html?demo=1"));
    const fetchFn = stubFetch(PAGE);
    expect(await recordWatch("vid12345678", { fetchFn })).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
