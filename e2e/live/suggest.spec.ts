// Live tier: profile suggestions against real providers. Lands directly on
// the settings route so no feed scoring runs (this spec costs one call).
import { test, expect } from "@playwright/test";
import { openFeedWithLiveSeed } from "../helpers/live";
import { clickSuggestProfile, getSuggestionText } from "../helpers/settings";
import { LIVE_PROFILE, LIVE_VIDEOS } from "./fixtures";
import type { FeedbackEntry, Provider, Vote } from "../../src/lib/types";

function vote(videoId: string, v: Vote, title: string, channel: string): FeedbackEntry {
  return {
    videoId,
    vote: v,
    votedAt: Date.now(),
    title,
    channelTitle: channel,
    durationText: "20:00",
    source: "home",
    descriptionSnippet: null,
    score: v === "up" ? 80 : 35,
    reason: v === "up" ? "substantive" : "engagement bait",
    clickbait: v === "down",
  };
}

const VOTES = [
  vote("upvid000001", "up", "Compiler internals: how register allocation actually works", "Low Level Lectures"),
  vote("downvid0001", "down", "Top 10 SHOCKING Celebrity Meltdowns", "Gossip Feed"),
  vote("downvid0002", "down", "This Prank Went TOO FAR (cops called)", "Prank Nation"),
];

const PROVIDERS: Array<{ provider: Provider; envVar: string }> = [
  { provider: "anthropic", envVar: "ANTHROPIC_API_KEY" },
  { provider: "openai", envVar: "OPENAI_API_KEY" },
];

for (const { provider, envVar } of PROVIDERS) {
  test(`should return a non-empty profile suggestion from ${provider}`, async ({ page }) => {
    const apiKey = process.env[envVar];
    test.skip(!apiKey, `${envVar} not set — live tier needs .env.production or env keys`);

    await openFeedWithLiveSeed(page, {
      provider,
      apiKey: apiKey!,
      profile: LIVE_PROFILE,
      videos: LIVE_VIDEOS,
      feedback: VOTES,
      route: "#/settings",
    });

    await clickSuggestProfile(page);
    const text = await getSuggestionText(page);

    // innerText reflects the CSS-uppercased headings — match case-insensitively.
    expect(text.toLowerCase()).toContain("suggested — more of this");
    expect(text.toLowerCase()).toContain("suggested — less of this");
    // The suggestion must carry real content, not empty strings.
    expect(text.length).toBeGreaterThan(120);
  });
}
