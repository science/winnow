import { describe, it, expect } from "vitest";
import {
  ANDROID_CLIENT,
  fetchTranscriptExcerpt,
  parseTimedtextXml,
  pickCaptionTrack,
  parseJson3Transcript,
  captionTracksFrom,
} from "./transcripts";

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
    expect(parseJson3Transcript(json3, 8)).toBe("Hello wo");
  });

  it("should return null for empty or malformed input", () => {
    expect(parseJson3Transcript({}, 100)).toBeNull();
    expect(parseJson3Transcript({ events: [] }, 100)).toBeNull();
    expect(parseJson3Transcript(null, 100)).toBeNull();
  });
});

describe("parseTimedtextXml", () => {
  const XML = [
    `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3">`,
    `<body>`,
    `<p t="1200" d="2160">All right, so here we are,\nin front of the elephants</p>`,
    `<p t="3400" d="100"></p>`,
    `<p t="5000" d="900">they have really, really, really long trunks &amp; that&#39;s cool</p>`,
    `</body></timedtext>`,
  ].join("\n");

  it("should flatten <p> lines into plain text with entities decoded", () => {
    expect(parseTimedtextXml(XML, 2000)).toBe(
      "All right, so here we are, in front of the elephants they have really, really, really long trunks & that's cool",
    );
  });

  it("should strip word-level <s> tags", () => {
    const xml = `<timedtext format="3"><body><p t="0" d="1"><s>Hello</s><s> world</s></p></body></timedtext>`;
    expect(parseTimedtextXml(xml, 2000)).toBe("Hello world");
  });

  it("should cap at maxChars", () => {
    expect(parseTimedtextXml(XML, 10)).toBe("All right,");
  });

  it("should return null for empty or non-timedtext input", () => {
    expect(parseTimedtextXml("", 100)).toBeNull();
    expect(parseTimedtextXml("<html>Sorry...</html>", 100)).toBeNull();
    expect(parseTimedtextXml(`<timedtext format="3"><body></body></timedtext>`, 100)).toBeNull();
  });
});

// The real player-response shape (captured 2026-07-14) — the same
// captions.playerCaptionsTracklistRenderer subtree the InnerTube player
// endpoint returns, so synthetic drift can't hide a seam break.
describe("real player-response capture shape", () => {
  it("should pick the ASR English track from the real captionTracks shape", async () => {
    const player = (await import("./fixtures/watch-captiontracks-real.json")).default;
    const tracks = captionTracksFrom(player);
    expect(tracks.length).toBeGreaterThan(0);
    const picked = pickCaptionTrack(tracks);
    expect(picked?.languageCode).toBe("en");
    expect(picked?.baseUrl).toContain("timedtext");
  });
});

// Extension wiring: the InnerTube POST carries a moz-extension:// Origin,
// which Google's anti-abuse layer rejects with a bot-block 403. A DNR rule
// must rewrite Origin to https://www.youtube.com on /youtubei/ calls.
describe("Origin-rewrite manifest wiring", () => {
  it("should rewrite Origin on youtubei requests via DNR", async () => {
    const { readFileSync } = await import("node:fs");
    const rules = JSON.parse(
      readFileSync(new URL("../../../public/dnr-rules.json", import.meta.url), "utf8"),
    ) as Array<{
      action: { type: string; requestHeaders?: Array<{ header: string; operation: string; value?: string }> };
      condition: { urlFilter?: string; resourceTypes?: string[] };
    }>;
    const rule = rules.find((r) => r.condition.urlFilter?.includes("youtubei"));
    expect(rule).toBeDefined();
    expect(rule!.action.type).toBe("modifyHeaders");
    const origin = rule!.action.requestHeaders?.find((h) => h.header === "Origin");
    expect(origin).toEqual({ header: "Origin", operation: "set", value: "https://www.youtube.com" });
    expect(rule!.condition.resourceTypes).toContain("xmlhttprequest");
  });

  it("should not request the cookies permission (SAPISID auth is gone)", async () => {
    const { readFileSync } = await import("node:fs");
    const manifest = JSON.parse(
      readFileSync(new URL("../../../public/manifest.json", import.meta.url), "utf8"),
    ) as { permissions: string[]; host_permissions: string[] };
    expect(manifest.permissions).not.toContain("cookies");
    expect(manifest.permissions).toContain("declarativeNetRequestWithHostAccess");
    expect(manifest.host_permissions.some((h) => h.includes("youtube.com"))).toBe(true);
  });
});

// --- fetch chain: player (ANDROID client) → caption track → timedtext ----

const PLAYER_RESPONSE = {
  playabilityStatus: { status: "OK" },
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [
        { baseUrl: "https://www.youtube.com/api/timedtext?v=x&lang=en", languageCode: "en", kind: "asr" },
      ],
    },
  },
};

const TIMEDTEXT_XML = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body><p t="0" d="1">From timedtext XML</p></body></timedtext>`;

interface StubOpts {
  playerStatus?: number;
  playerBody?: unknown;
  timedtextStatus?: number;
  timedtextBody?: string;
}

function fetchStub(opts: StubOpts = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.includes("youtubei/v1/player")) {
      return new Response(JSON.stringify(opts.playerBody ?? PLAYER_RESPONSE), {
        status: opts.playerStatus ?? 200,
      });
    }
    if (u.includes("timedtext")) {
      return new Response(opts.timedtextBody ?? TIMEDTEXT_XML, {
        status: opts.timedtextStatus ?? 200,
      });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
  return { fetchFn, calls };
}

describe("fetchTranscriptExcerpt", () => {
  it("should fetch player with the ANDROID client and return the timedtext excerpt", async () => {
    const { fetchFn, calls } = fetchStub();
    const result = await fetchTranscriptExcerpt("vid00000001", 2000, { fetchFn });
    expect(result).toEqual({ excerpt: "From timedtext XML", source: "player" });

    const player = calls.find((c) => c.url.includes("youtubei/v1/player"))!;
    const body = JSON.parse(String(player.init?.body)) as {
      context: { client: Record<string, unknown> };
      videoId: string;
    };
    expect(body.videoId).toBe("vid00000001");
    expect(body.context.client["clientName"]).toBe(ANDROID_CLIENT.clientName);
    expect(body.context.client["clientVersion"]).toBe(ANDROID_CLIENT.clientVersion);
  });

  it("should send both requests cookie-less (credentials omit)", async () => {
    const { fetchFn, calls } = fetchStub();
    await fetchTranscriptExcerpt("vid00000001", 2000, { fetchFn });
    expect(calls.length).toBe(2);
    for (const c of calls) expect(c.init?.credentials).toBe("omit");
  });

  it("should parse a json3 timedtext body when YouTube honors fmt=json3", async () => {
    const { fetchFn } = fetchStub({
      timedtextBody: JSON.stringify({ events: [{ segs: [{ utf8: "From json3" }] }] }),
    });
    const result = await fetchTranscriptExcerpt("vid00000001", 2000, { fetchFn });
    expect(result).toEqual({ excerpt: "From json3", source: "player" });
  });

  it("should report the player HTTP status when the player call is rejected", async () => {
    const { fetchFn } = fetchStub({ playerStatus: 403 });
    expect(await fetchTranscriptExcerpt("vid00000001", 2000, { fetchFn })).toEqual({
      failure: "player-http-403",
    });
  });

  it("should report no-tracks when the video has no captions", async () => {
    const { fetchFn } = fetchStub({ playerBody: { playabilityStatus: { status: "OK" } } });
    expect(await fetchTranscriptExcerpt("vid00000001", 2000, { fetchFn })).toEqual({
      failure: "no-tracks",
    });
  });

  it("should report the timedtext HTTP status when the caption fetch fails", async () => {
    const { fetchFn } = fetchStub({ timedtextStatus: 404 });
    expect(await fetchTranscriptExcerpt("vid00000001", 2000, { fetchFn })).toEqual({
      failure: "timedtext-http-404",
    });
  });

  it("should report empty-body when timedtext returns nothing (pot gating)", async () => {
    const { fetchFn } = fetchStub({ timedtextBody: "" });
    expect(await fetchTranscriptExcerpt("vid00000001", 2000, { fetchFn })).toEqual({
      failure: "empty-body",
    });
  });

  it("should report parse-null for an unrecognized body", async () => {
    const { fetchFn } = fetchStub({ timedtextBody: "<html>Sorry...</html>" });
    expect(await fetchTranscriptExcerpt("vid00000001", 2000, { fetchFn })).toEqual({
      failure: "parse-null",
    });
  });

  it("should report network when the fetch itself throws", async () => {
    const fetchFn = (async () => {
      throw new TypeError("NetworkError");
    }) as typeof fetch;
    expect(await fetchTranscriptExcerpt("vid00000001", 2000, { fetchFn })).toEqual({
      failure: "network",
    });
  });
});
