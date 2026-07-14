import { describe, it, expect } from "vitest";
import {
  extractPlayerResponse,
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
