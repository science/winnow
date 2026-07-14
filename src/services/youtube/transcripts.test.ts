import { describe, it, expect } from "vitest";
import {
  extractPlayerResponse,
  extractTranscriptParams,
  fetchTranscriptExcerpt,
  parseInnertubeTranscript,
  pickCaptionTrack,
  parseJson3Transcript,
  captionTracksFrom,
} from "./transcripts";

const WATCH_HTML = `<html><script>var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=x","languageCode":"en","kind":"asr"},{"baseUrl":"https://www.youtube.com/api/timedtext?v=y","languageCode":"en"}]}}};var meta = {};</script></html>`;

describe("extractPlayerResponse", () => {
  it("should extract the player response blob from a watch page", () => {
    const pr = extractPlayerResponse(WATCH_HTML);
    expect(captionTracksFrom(pr)).toHaveLength(2);
  });

  it("should return null when absent or malformed", () => {
    expect(extractPlayerResponse("<html></html>")).toBeNull();
    expect(extractPlayerResponse("var ytInitialPlayerResponse = {broken;</script>")).toBeNull();
  });
});

describe("pickCaptionTrack", () => {
  it("should prefer human-made English over auto-generated", () => {
    const picked = pickCaptionTrack([
      { baseUrl: "asr-url", languageCode: "en", kind: "asr" },
      { baseUrl: "manual-url", languageCode: "en" },
    ]);
    expect(picked?.baseUrl).toBe("manual-url");
  });

  it("should fall back to ASR English, then any track", () => {
    expect(pickCaptionTrack([{ baseUrl: "u", languageCode: "en", kind: "asr" }])?.baseUrl).toBe("u");
    expect(pickCaptionTrack([{ baseUrl: "fr", languageCode: "fr" }])?.baseUrl).toBe("fr");
    expect(pickCaptionTrack([])).toBeNull();
    expect(pickCaptionTrack([{ languageCode: "en" }])).toBeNull();
  });
});

describe("parseJson3Transcript", () => {
  const json3 = {
    events: [
      { segs: [{ utf8: "Hello" }, { utf8: " world" }] },
      { tStartMs: 100 }, // no segs — skipped
      { segs: [{ utf8: "second\nline" }] },
    ],
  };

  it("should flatten segments into plain text", () => {
    expect(parseJson3Transcript(json3, 2000)).toBe("Hello world second line");
  });

  it("should cap at maxChars", () => {
    const result = parseJson3Transcript(json3, 8);
    expect(result).toBe("Hello wo");
  });

  it("should return null for empty or malformed input", () => {
    expect(parseJson3Transcript({}, 100)).toBeNull();
    expect(parseJson3Transcript({ events: [] }, 100)).toBeNull();
    expect(parseJson3Transcript(null, 100)).toBeNull();
  });
});

const WATCH_INITIAL_DATA = {
  engagementPanels: [
    { engagementPanelSectionListRenderer: { panelIdentifier: "unrelated" } },
    {
      engagementPanelSectionListRenderer: {
        content: {
          continuationItemRenderer: {
            continuationEndpoint: { getTranscriptEndpoint: { params: "TESTPARAMS==" } },
          },
        },
      },
    },
  ],
};

describe("extractTranscriptParams", () => {
  it("should find getTranscriptEndpoint params in watch-page ytInitialData", () => {
    expect(extractTranscriptParams(WATCH_INITIAL_DATA)).toBe("TESTPARAMS==");
  });

  it("should return null when no transcript panel exists", () => {
    expect(extractTranscriptParams({ engagementPanels: [] })).toBeNull();
    expect(extractTranscriptParams(null)).toBeNull();
    expect(extractTranscriptParams({ getTranscriptEndpoint: { params: 42 } })).toBeNull();
  });
});

describe("SAPISIDHASH manifest wiring", () => {
  it("should hold the cookies permission the SAPISID read requires", async () => {
    const { readFileSync } = await import("node:fs");
    const manifest = JSON.parse(
      readFileSync(new URL("../../../public/manifest.json", import.meta.url), "utf8"),
    ) as { permissions: string[]; host_permissions: string[] };
    expect(manifest.permissions).toContain("cookies");
    expect(manifest.host_permissions.some((h) => h.includes("youtube.com"))).toBe(true);
  });
});

// Fixtures pruned from a real watch-page capture (2026-07-14): the shapes
// YouTube actually serves, so synthetic drift can't hide a seam break.
describe("real watch-page capture shapes", () => {
  it("should pick the ASR English track from the real captionTracks shape", async () => {
    const player = (await import("./fixtures/watch-captiontracks-real.json")).default;
    const tracks = captionTracksFrom(player);
    expect(tracks.length).toBeGreaterThan(0);
    const picked = pickCaptionTrack(tracks);
    expect(picked?.languageCode).toBe("en");
    expect(picked?.baseUrl).toContain("timedtext");
  });

  it("should find getTranscriptEndpoint params in the real engagement-panel shape", async () => {
    const data = (await import("./fixtures/watch-transcript-params-real.json")).default;
    const params = extractTranscriptParams(data);
    expect(params).toMatch(/^Cgsw/);
    expect(params!.length).toBeGreaterThan(100);
  });
});

describe("parseInnertubeTranscript", () => {
  const modern = {
    actions: [
      {
        updateEngagementPanelAction: {
          content: {
            transcriptRenderer: {
              body: {
                transcriptSegmentListRenderer: {
                  initialSegments: [
                    { transcriptSegmentRenderer: { snippet: { runs: [{ text: "Hello" }, { text: " world" }] } } },
                    { transcriptSegmentRenderer: { snippet: { runs: [{ text: "second\nline" }] } } },
                  ],
                },
              },
            },
          },
        },
      },
    ],
  };

  it("should flatten InnerTube transcript segments into an excerpt", () => {
    expect(parseInnertubeTranscript(modern, 2000)).toBe("Hello world second line");
  });

  it("should read the older cue-renderer shape", () => {
    const older = {
      cueGroups: [
        { transcriptCueGroupRenderer: { cues: [{ transcriptCueRenderer: { cue: { simpleText: "Old shape" } } }] } },
        { transcriptCueGroupRenderer: { cues: [{ transcriptCueRenderer: { cue: { simpleText: "text" } } }] } },
      ],
    };
    expect(parseInnertubeTranscript(older, 2000)).toBe("Old shape text");
  });

  it("should cap at maxChars", () => {
    expect(parseInnertubeTranscript(modern, 8)).toBe("Hello wo");
  });

  it("should return null for malformed input", () => {
    expect(parseInnertubeTranscript({}, 100)).toBeNull();
    expect(parseInnertubeTranscript(null, 100)).toBeNull();
  });
});

// --- fetch chain: timedtext first, InnerTube fallback -------------------

const CHAIN_WATCH_HTML = [
  `<html><script>ytcfg.set({"INNERTUBE_API_KEY":"AIzaChain","INNERTUBE_CONTEXT_CLIENT_VERSION":"2.20260101.00.00","LOGGED_IN":true});</script>`,
  `<script>var ytInitialData = ${JSON.stringify(WATCH_INITIAL_DATA)};</script>`,
  `<script>var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=x","languageCode":"en"}]}}};var meta = {};</script></html>`,
].join("\n");

const INNERTUBE_RESPONSE = {
  actions: [
    {
      updateEngagementPanelAction: {
        content: {
          transcriptRenderer: {
            body: {
              transcriptSegmentListRenderer: {
                initialSegments: [
                  { transcriptSegmentRenderer: { snippet: { runs: [{ text: "From InnerTube" }] } } },
                ],
              },
            },
          },
        },
      },
    },
  ],
};

function fetchStub(opts: { timedtextBody: string; innertubeStatus?: number }) {
  const calls: string[] = [];
  const headersByUrl = new Map<string, Record<string, string>>();
  const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push(u);
    headersByUrl.set(u, (init?.headers as Record<string, string>) ?? {});
    if (u.includes("/watch?v=")) return new Response(CHAIN_WATCH_HTML, { status: 200 });
    if (u.includes("timedtext")) return new Response(opts.timedtextBody, { status: 200 });
    if (u.includes("youtubei/v1/get_transcript")) {
      return new Response(JSON.stringify(INNERTUBE_RESPONSE), { status: opts.innertubeStatus ?? 200 });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
  const innertubeHeaders = (): Record<string, string> | undefined => {
    const url = calls.find((u) => u.includes("youtubei/v1/get_transcript"));
    return url ? headersByUrl.get(url) : undefined;
  };
  return { fetchFn, calls, innertubeHeaders };
}

describe("fetchTranscriptExcerpt", () => {
  it("should return the timedtext excerpt without calling InnerTube when it works", async () => {
    const { fetchFn, calls } = fetchStub({
      timedtextBody: JSON.stringify({ events: [{ segs: [{ utf8: "From timedtext" }] }] }),
    });
    const result = await fetchTranscriptExcerpt("vid00000001", 2000, { fetchFn });
    expect(result).toEqual({ excerpt: "From timedtext", source: "timedtext" });
    expect(calls.some((u) => u.includes("youtubei"))).toBe(false);
  });

  it("should fall back to InnerTube when timedtext returns an empty body", async () => {
    const { fetchFn, calls } = fetchStub({ timedtextBody: "" });
    const result = await fetchTranscriptExcerpt("vid00000001", 2000, { fetchFn });
    expect(result).toEqual({ excerpt: "From InnerTube", source: "innertube" });
    expect(calls.some((u) => u.includes("youtubei/v1/get_transcript"))).toBe(true);
  });

  it("should return null when both paths fail", async () => {
    const { fetchFn } = fetchStub({ timedtextBody: "", innertubeStatus: 403 });
    expect(await fetchTranscriptExcerpt("vid00000001", 2000, { fetchFn })).toBeNull();
  });

  it("should sign the InnerTube call with SAPISIDHASH when the cookie is readable", async () => {
    const { fetchFn, innertubeHeaders } = fetchStub({ timedtextBody: "" });
    const result = await fetchTranscriptExcerpt("vid00000001", 2000, {
      fetchFn,
      getSapisidFn: async () => "test-sapisid-value",
    });
    expect(result).toEqual({ excerpt: "From InnerTube", source: "innertube" });
    const headers = innertubeHeaders()!;
    expect(headers["Authorization"]).toMatch(/^SAPISIDHASH \d+_[0-9a-f]{40}$/);
    expect(headers["X-Origin"]).toBe("https://www.youtube.com");
  });

  it("should degrade to cookies-only headers when no SAPISID is available", async () => {
    const { fetchFn, innertubeHeaders } = fetchStub({ timedtextBody: "" });
    await fetchTranscriptExcerpt("vid00000001", 2000, {
      fetchFn,
      getSapisidFn: async () => null,
    });
    const headers = innertubeHeaders()!;
    expect(headers["Authorization"]).toBeUndefined();
    expect(headers["X-Origin"]).toBeUndefined();
  });
});
