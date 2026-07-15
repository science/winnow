import { describe, it, expect } from "vitest";
import { scrubCapture, scanSuspectKeys } from "./captureScrub";

describe("scrubCapture", () => {
  it("should remove PII keys at every depth", () => {
    const bundle = {
      home: {
        contents: {
          clickTrackingParams: "CJa=",
          rows: [
            {
              video: { videoId: "abc123", title: "Keep me" },
              trackingParams: "CJb=",
              menu: {
                items: [
                  { feedbackEndpoint: { feedbackToken: "AB_t", undoToken: "UN_t" } },
                ],
              },
            },
          ],
        },
        responseContext: { mainAppWebResponseContext: { datasyncId: "1132||" } },
      },
      transcript: {
        videoId: "abc123",
        playerResponse: {
          responseContext: { visitorData: "Cgt=", rolloutToken: "CPq=" },
          videoDetails: { videoId: "abc123", lengthSeconds: "600" },
        },
      },
    };
    const out = scrubCapture(bundle) as any;
    expect(out.home.contents.clickTrackingParams).toBeUndefined();
    expect(out.home.contents.rows[0].trackingParams).toBeUndefined();
    expect(out.home.contents.rows[0].menu.items[0].feedbackEndpoint).toEqual({});
    expect(out.home.responseContext).toBeUndefined();
    expect(out.transcript.playerResponse.responseContext).toBeUndefined();
    // Content siblings survive untouched.
    expect(out.home.contents.rows[0].video).toEqual({ videoId: "abc123", title: "Keep me" });
    expect(out.transcript.playerResponse.videoDetails.videoId).toBe("abc123");
  });

  it("should drop non-content feed subtrees but keep contents", () => {
    const feedPart = {
      contents: { twoColumnBrowseResultsRenderer: { tabs: [] } },
      topbar: { desktopTopbarRenderer: { accountName: "Steve" } },
      header: { feedTabbedHeaderRenderer: {} },
      frameworkUpdates: { entityBatchUpdate: {} },
      onResponseReceivedActions: [{ action: "x" }],
      trackingParams: "CJc=",
    };
    const out = scrubCapture({ home: feedPart, subscriptions: feedPart }) as any;
    for (const part of [out.home, out.subscriptions]) {
      expect(part.contents).toEqual({ twoColumnBrowseResultsRenderer: { tabs: [] } });
      expect(part.topbar).toBeUndefined();
      expect(part.header).toBeUndefined();
      expect(part.frameworkUpdates).toBeUndefined();
      expect(part.onResponseReceivedActions).toBeUndefined();
      expect(part.trackingParams).toBeUndefined();
    }
  });

  it("should leave non-feed sections in place, minus deep PII", () => {
    const out = scrubCapture({
      scoring: { target: { inputHash: "60362554", target: { fields: {} } } },
    }) as any;
    expect(out.scoring.target.target).toEqual({ fields: {} });
  });

  it("should not mutate its input", () => {
    const bundle = { home: { contents: {}, topbar: {}, trackingParams: "x" } };
    const snapshot = JSON.parse(JSON.stringify(bundle));
    scrubCapture(bundle);
    expect(bundle).toEqual(snapshot);
  });
});

describe("scanSuspectKeys", () => {
  it("should list residual suspect keys anywhere in the tree", () => {
    const found = scanSuspectKeys({
      a: { poToken: "x", playbackTracking: { url: "y" } },
      b: [{ visitorData: "z" }, { accountName: "s", avatar: { url: "u" } }],
      clean: { videoId: "abc", title: "t" },
    });
    expect(found).toEqual(
      expect.arrayContaining(["poToken", "playbackTracking", "visitorData", "accountName", "avatar"]),
    );
    expect(found).not.toContain("videoId");
    expect(found).not.toContain("title");
  });

  it("should return an empty list for a clean tree and dedupe repeats", () => {
    expect(scanSuspectKeys({ video: { videoId: "a" }, rows: [{ title: "t" }] })).toEqual([]);
    const dupes = scanSuspectKeys({ a: { token: 1 }, b: { token: 2 } });
    expect(dupes).toEqual(["token"]);
  });
});
