import { describe, expect, it } from "vitest";
import { get } from "svelte/store";
import { pruneStaleEntries, watched } from "./feedStore";
import { toggleVote } from "./feedbackStore";
import { KEYS, storageGet, storageSet } from "../lib/storage";
import type { TranscriptCacheEntry, Video } from "../lib/types";

function video(id: string): Video {
  return {
    id,
    source: "subscriptions",
    title: `Video ${id}`,
    channelTitle: "c",
    channelId: null,
    durationText: "10:00",
    durationSec: 600,
    publishedText: "1 day ago",
    publishedAtApprox: null,
    viewCountText: null,
    viewCount: null,
    thumbnailUrl: null,
    descriptionSnippet: null,
    isLive: false,
  };
}

const entry = (excerpt: string): TranscriptCacheEntry => ({
  excerpt,
  source: "timedtext",
  fetchedAt: 1,
});

describe("pruneStaleEntries", () => {
  it("should drop watched marks and transcript-cache entries for videos that left the feed window", async () => {
    watched.set({ stays0000001: 1, leaves000001: 2 });
    await storageSet(KEYS.transcripts, {
      stays0000001: entry("kept"),
      leaves000001: entry("dropped"),
    });

    await pruneStaleEntries([video("stays0000001")]);

    expect(get(watched)).toEqual({ stays0000001: 1 });
    const cache = await storageGet<Record<string, TranscriptCacheEntry>>(KEYS.transcripts);
    expect(cache).toEqual({ stays0000001: entry("kept") });
  });

  it("should keep transcript-cache entries for voted videos even after they leave the feed window", async () => {
    watched.set({});
    await toggleVote({ ...video("votedgone01"), scoreState: "unknown" }, "up");
    await storageSet(KEYS.transcripts, {
      votedgone01: entry("kept for feedback analysis"),
      unvotedgone: entry("dropped"),
    });

    await pruneStaleEntries([video("stays0000001")]);

    const cache = await storageGet<Record<string, TranscriptCacheEntry>>(KEYS.transcripts);
    expect(cache).toEqual({ votedgone01: entry("kept for feedback analysis") });
  });
});
