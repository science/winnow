// Deliberately extreme-contrast fixture videos so the directional assertion
// (substance outscores bait) is stable across model versions. IDs are fake
// but 11 chars like real YouTube ids; the scorer only echoes them back.
import type { Video } from "../../src/lib/types";

function video(partial: Pick<Video, "id" | "source" | "title" | "channelTitle"> & Partial<Video>): Video {
  return {
    channelId: null,
    durationText: "12:00",
    durationSec: 720,
    publishedText: "2 days ago",
    publishedAtApprox: null,
    viewCountText: "100K views",
    viewCount: 100_000,
    thumbnailUrl: null,
    descriptionSnippet: null,
    isLive: false,
    ...partial,
  };
}

export const SUBSTANCE_ID = "techdeep001";
export const BAIT_ID = "baitshock01";
export const NEUTRAL_ID = "cookpasta01";

export const LIVE_PROFILE = {
  moreOf:
    "deep technical software engineering content, systems programming, long-form lectures with real substance and working code",
  lessOf: "celebrity drama, shock-value clickbait, reaction content, get-rich-quick hype",
};

export const LIVE_VIDEOS: Video[] = [
  video({
    id: SUBSTANCE_ID,
    source: "subscriptions",
    title: "Understanding Rust's borrow checker: a two-hour deep dive with real examples",
    channelTitle: "Systems Programming Weekly",
    durationText: "2:04:33",
    durationSec: 7473,
    descriptionSnippet:
      "We walk through ownership, lifetimes, and aliasing rules with compiler diagnostics and real refactors.",
  }),
  video({
    id: BAIT_ID,
    source: "home",
    title: "You WON'T BELIEVE What This Billionaire Just Did 😱💰 (SHOCKING)",
    channelTitle: "Drama Central",
    durationText: "8:01",
    durationSec: 481,
    descriptionSnippet: "Number 7 will shock you. Smash that like button before it's too late!!!",
  }),
  video({
    id: NEUTRAL_ID,
    source: "home",
    title: "Weeknight pasta: a simple 20-minute carbonara",
    channelTitle: "Home Kitchen Basics",
    durationText: "9:45",
    durationSec: 585,
    descriptionSnippet: "A straightforward carbonara with pantry ingredients.",
  }),
];
