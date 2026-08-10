import { describe, expect, it, beforeEach } from "vitest";
import { get } from "svelte/store";
import { scores, videos, watched } from "./feedStore";
import { discovered } from "./discoveryStore";
import {
  closePlayer,
  displayDiscoveryTiers,
  displayTiers,
  openPlayer,
  openVideoId,
} from "./playerStore";
import type { Video, VideoScore } from "../lib/types";

function video(id: string): Video {
  return {
    id,
    source: "subscriptions",
    title: `Video ${id}`,
    channelTitle: "c",
    channelId: null,
    durationText: null,
    durationSec: null,
    publishedText: null,
    publishedAtApprox: null,
    viewCountText: null,
    viewCount: null,
    thumbnailUrl: null,
    descriptionSnippet: null,
    isLive: false,
  };
}

const score = (n: number): VideoScore => ({
  score: n,
  reason: "r",
  clickbait: false,
  scoredAt: 1,
  model: "m",
});

const ids = (list: { id: string }[]): string[] => list.map((v) => v.id);

describe("playerStore", () => {
  beforeEach(() => {
    closePlayer();
    watched.set({});
    videos.set([]);
    discovered.set([]);
    scores.set({});
  });

  it("should freeze the feed order while a player is open", () => {
    videos.set([video("firstvideo1"), video("secondvideo")]);
    scores.set({ firstvideo1: score(90), secondvideo: score(85) });
    expect(ids(get(displayTiers).top)).toEqual(["firstvideo1", "secondvideo"]);

    openPlayer("firstvideo1");
    // A watched mark would normally sink firstvideo1 to the tier's tail.
    expect(ids(get(displayTiers).top)).toEqual(["firstvideo1", "secondvideo"]);
  });

  it("should freeze the discovery order while a player is open", () => {
    discovered.set([
      { video: { ...video("discoone001"), source: "search" }, query: "q", discoveredAt: 1 },
      { video: { ...video("discotwo001"), source: "search" }, query: "q", discoveredAt: 2 },
    ]);
    scores.set({ discoone001: score(90), discotwo001: score(85) });

    openPlayer("discoone001");
    expect(ids(get(displayDiscoveryTiers).top)).toEqual(["discoone001", "discotwo001"]);
  });

  it("should not re-snapshot when a second video opens before the first is closed", () => {
    videos.set([video("firstvideo1"), video("secondvideo")]);
    scores.set({ firstvideo1: score(90), secondvideo: score(85) });

    openPlayer("firstvideo1");
    openPlayer("secondvideo");

    expect(get(openVideoId)).toBe("secondvideo");
    // Both are watched now; the held order from the first open still stands.
    expect(ids(get(displayTiers).top)).toEqual(["firstvideo1", "secondvideo"]);
  });

  it("should mark the opened video watched without moving its card", () => {
    videos.set([video("firstvideo1"), video("secondvideo")]);
    scores.set({ firstvideo1: score(90), secondvideo: score(85) });

    openPlayer("firstvideo1");

    expect(Object.keys(get(watched))).toEqual(["firstvideo1"]);
    expect(ids(get(displayTiers).top)).toEqual(["firstvideo1", "secondvideo"]);
  });

  it("should restore the live order when the player closes", () => {
    videos.set([video("firstvideo1"), video("secondvideo")]);
    scores.set({ firstvideo1: score(90), secondvideo: score(85) });

    openPlayer("firstvideo1");
    closePlayer();

    expect(get(openVideoId)).toBeNull();
    // Deliberate: the just-watched card sinks once the player is closed.
    expect(ids(get(displayTiers).top)).toEqual(["secondvideo", "firstvideo1"]);
  });
});
