import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSuggestMessage,
  MIN_VOTES_FOR_SUGGESTION,
  SUGGEST_TRANSCRIPT_CHARS,
  suggestProfileUpdate,
} from "./profileSuggest";
import { feedback } from "../../stores/feedbackStore";
import { profile, settings } from "../../stores/settingsStore";
import type { FeedbackEntry, Profile, Vote } from "../../lib/types";

const PROFILE: Profile = {
  moreOf: "deep technical dives and long-form lectures",
  lessOf: "celebrity drama",
  updatedAt: 0,
};

function entry(videoId: string, vote: Vote, title = `Video ${videoId}`): FeedbackEntry {
  return {
    videoId,
    vote,
    votedAt: 100,
    title,
    channelTitle: "Channel",
    durationText: "10:00",
    source: "home",
    descriptionSnippet: null,
    score: 42,
    reason: "meh",
    clickbait: false,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  feedback.set({});
});

describe("buildSuggestMessage", () => {
  it("should include the current profile text verbatim", () => {
    const msg = buildSuggestMessage(PROFILE, [entry("vid00000001", "down")], {});
    expect(msg).toContain("deep technical dives and long-form lectures");
    expect(msg).toContain("celebrity drama");
  });

  it("should include cached transcripts for voted videos", () => {
    const msg = buildSuggestMessage(PROFILE, [entry("vid00000001", "down")], {
      vid00000001: "the transcript says it is all gossip",
    });
    expect(msg).toContain("the transcript says it is all gossip");
  });

  it("should truncate transcript excerpts in the suggestion message", () => {
    const long = "x".repeat(SUGGEST_TRANSCRIPT_CHARS + 500);
    const msg = buildSuggestMessage(PROFILE, [entry("vid00000001", "down")], { vid00000001: long });
    expect(msg).not.toContain(long);
    expect(msg).toContain("x".repeat(SUGGEST_TRANSCRIPT_CHARS));
  });

  it("should describe each vote with the model's verdict when present", () => {
    const msg = buildSuggestMessage(PROFILE, [entry("vid00000001", "up", "A Great Video")], {});
    expect(msg).toContain("A Great Video");
    expect(msg).toContain('"vote": "up"');
    expect(msg).toContain("42");
  });
});

describe("suggestProfileUpdate", () => {
  it("should require a minimum number of votes", async () => {
    feedback.set({
      a: entry("a", "up"),
      b: entry("b", "down"),
    });
    await expect(suggestProfileUpdate()).rejects.toThrow(/rate at least/i);
  });

  it("should return a parsed suggestion from the provider response", async () => {
    settings.set({ provider: "anthropic", anthropicApiKey: "test-key", openaiApiKey: null });
    profile.set(PROFILE);
    feedback.set({
      a: entry("a", "up"),
      b: entry("b", "down"),
      c: entry("c", "down"),
    });
    const suggestion = { moreOf: "more of this", lessOf: "less of this", rationale: "because" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            content: [{ type: "tool_use", name: "suggest_profile", input: suggestion }],
          }),
          // The SDK only JSON-parses application/json bodies.
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(suggestProfileUpdate()).resolves.toEqual(suggestion);
  });
});
