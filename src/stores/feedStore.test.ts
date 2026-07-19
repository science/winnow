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

  it("should prune enrichment digests with the feed window, keeping voted videos", async () => {
    watched.set({});
    await toggleVote({ ...video("votedenrich"), scoreState: "unknown" }, "up");
    const digestEntry = { digest: {}, contentHash: "x", model: "m", promptVersion: 1, hadTranscript: true, enrichedAt: 1 };
    await storageSet(KEYS.enrichment, {
      stays0000001: digestEntry,
      votedenrich: digestEntry,
      leaves000001: digestEntry,
    });

    await pruneStaleEntries([video("stays0000001")]);

    const cache = await storageGet<Record<string, unknown>>(KEYS.enrichment);
    expect(Object.keys(cache!).sort()).toEqual(["stays0000001", "votedenrich"]);
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

  // Keep this test LAST in the file: it switches the active profile, which
  // would change where earlier tests' toggleVote calls persist.
  it("should keep transcript entries for videos voted in any profile, not just the active one", async () => {
    watched.set({});
    await toggleVote({ ...video("votedinother"), scoreState: "unknown" }, "up");
    const { addProfileAction } = await import("./profilesStore");
    const secondId = await addProfileAction("Second");
    // Reload empties the in-memory store — the kept vote is only reachable
    // through the default profile's persisted blob.
    const { reloadFeedback } = await import("./feedbackStore");
    await reloadFeedback(secondId);

    await storageSet(KEYS.transcripts, {
      votedinother: entry("kept — voted in the default profile"),
      plainold0001: entry("dropped"),
    });

    await pruneStaleEntries([]);

    const cache = await storageGet<Record<string, TranscriptCacheEntry>>(KEYS.transcripts);
    expect(cache).toEqual({ votedinother: entry("kept — voted in the default profile") });
  });
});
