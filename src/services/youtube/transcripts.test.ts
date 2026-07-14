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
  const fetchFn = (async (url: RequestInfo | URL) => {
    const u = String(url);
    calls.push(u);
    if (u.includes("/watch?v=")) return new Response(CHAIN_WATCH_HTML, { status: 200 });
    if (u.includes("timedtext")) return new Response(opts.timedtextBody, { status: 200 });
    if (u.includes("youtubei/v1/get_transcript")) {
      return new Response(JSON.stringify(INNERTUBE_RESPONSE), { status: opts.innertubeStatus ?? 200 });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
  return { fetchFn, calls };
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
});
