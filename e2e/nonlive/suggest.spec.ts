import { test, expect } from "@playwright/test";
import {
  openSettingsDemoWithState,
  expectSuggestProfileEnabled,
  clickSuggestProfile,
  getSuggestionText,
  applySuggestion,
  dismissSuggestion,
  readActiveProfile,
} from "../helpers";
import type { FeedbackEntry, Vote } from "../../src/lib/types";

// Demo mode returns a deterministic stub suggestion built from the votes,
// so the whole suggest → approve/dismiss flow runs offline.

function vote(videoId: string, v: Vote, title: string): FeedbackEntry {
  return {
    videoId,
    vote: v,
    votedAt: Date.now(),
    title,
    channelTitle: "Channel",
    durationText: "10:00",
    source: "home",
    descriptionSnippet: null,
    score: 50,
    reason: "r",
    clickbait: false,
  };
}

const THREE_VOTES = [
  vote("upvid000001", "up", "Excellent Woodworking Process"),
  vote("downvid0001", "down", "Shocking Drama Reaction"),
  vote("downvid0002", "down", "You Won't Believe This"),
];

const START_PROFILE = { moreOf: "science lectures", lessOf: "drama" };

test("should disable profile suggestions until enough votes exist", async ({ page }) => {
  await openSettingsDemoWithState(page, { feedback: THREE_VOTES.slice(0, 2) });
  await expectSuggestProfileEnabled(page, false);
});

test("should show a suggested profile and apply it only on approval", async ({ page }) => {
  await openSettingsDemoWithState(page, { feedback: THREE_VOTES, profile: START_PROFILE });
  await expectSuggestProfileEnabled(page, true);
  await clickSuggestProfile(page);

  const text = await getSuggestionText(page);
  expect(text).toContain("Excellent Woodworking Process");

  // Nothing persists until Apply.
  const before = await readActiveProfile(page);
  expect(before!.moreOf).toBe("science lectures");

  await applySuggestion(page);
  await expect
    .poll(async () => (await readActiveProfile(page))!.moreOf)
    .toContain("Excellent Woodworking Process");
});

test("should leave the profile untouched on dismiss", async ({ page }) => {
  await openSettingsDemoWithState(page, { feedback: THREE_VOTES, profile: START_PROFILE });
  await clickSuggestProfile(page);
  await getSuggestionText(page);

  await dismissSuggestion(page);

  const after = await readActiveProfile(page);
  expect(after!.moreOf).toBe("science lectures");
  expect(after!.lessOf).toBe("drama");
});
