// Integration tests for scoreFeed's per-profile persistence: real stores and
// storage (in-memory fallback), mocked provider adapter and transcript fetch.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import type { Video, VideoScore } from "../../lib/types";

vi.mock("./anthropicScorer", () => ({
  ANTHROPIC_MODEL: "claude-test-model",
  scoreBatchAnthropic: vi.fn(),
}));
vi.mock("../youtube/transcripts", () => ({
  fetchTranscriptExcerpt: vi.fn(async () => ({ failure: "disabled-in-test" })),
}));

beforeEach(() => {
  vi.resetModules();
});

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

interface StoredScores {
  profileHash: string;
  scores: Record<string, VideoScore>;
}

/** Boot the module graph: seed settings/profile, put videos in the feed
 * store, and wire the mocked adapter to score everything at 80. */
async function boot(videoIds: string[]) {
  const storage = await import("../../lib/storage");
  const settingsStore = await import("../../stores/settingsStore");
  await settingsStore.settingsReady;
  settingsStore.settings.set({
    ...settingsStore.DEFAULT_SETTINGS,
    anthropicApiKey: "sk-test",
    scoringStrategy: "direct",
  });
  settingsStore.profile.update((p) => ({ ...p, moreOf: "trains", updatedAt: 1 }));

  const feedStore = await import("../../stores/feedStore");
  feedStore.videos.set(videoIds.map(video));

  const adapters = await import("./anthropicScorer");
  const adapterMock = vi.mocked(adapters.scoreBatchAnthropic);
  // The mock fn survives vi.resetModules — drop call counts from prior tests.
  adapterMock.mockReset();
  adapterMock.mockImplementation(async (batch: Video[]) =>
    batch.map((v) => ({ videoId: v.id, score: 80, reason: "on profile", clickbait: false })),
  );

  const profilesStore = await import("../../stores/profilesStore");
  const scorer = await import("./scorer");
  return { storage, settingsStore, feedStore, profilesStore, scorer, adapterMock };
}

describe("scoreFeed per-profile persistence (direct mode)", () => {
  it("should read and write scores under the active profile's key, not the legacy key", async () => {
    const { storage, profilesStore, feedStore, scorer } = await boot(["vid00000001"]);

    await scorer.scoreFeed();

    const activeId = get(profilesStore.profilesState).activeProfileId;
    const stored = await storage.storageGet<StoredScores>(storage.profileKeys(activeId).scores);
    expect(stored?.scores["vid00000001"]?.score).toBe(80);
    expect(await storage.storageGet(storage.KEYS.scores)).toBeNull();
    expect(get(feedStore.scores)["vid00000001"]?.score).toBe(80);
  });

  it("should use each profile's own cache: a fresh profile re-scores, switching back hits cache", async () => {
    const { storage, profilesStore, settingsStore, scorer, adapterMock } = await boot([
      "vid00000001",
    ]);

    await scorer.scoreFeed();
    expect(adapterMock).toHaveBeenCalledTimes(1);

    // New empty-cache profile: same video is a miss again.
    await profilesStore.addProfileAction("Engineering");
    settingsStore.profile.update((p) => ({ ...p, moreOf: "SWE tips", updatedAt: 2 }));
    await scorer.scoreFeed();
    expect(adapterMock).toHaveBeenCalledTimes(2);

    // Both profiles hold their own copy.
    const state = get(profilesStore.profilesState);
    for (const p of state.profiles) {
      const stored = await storage.storageGet<StoredScores>(storage.profileKeys(p.id).scores);
      expect(stored?.scores["vid00000001"]?.score).toBe(80);
    }
  });

  it("should persist a finishing run under the profile it started with, without touching the visible stores", async () => {
    const { storage, profilesStore, feedStore, scorer, adapterMock } = await boot(["vid00000001"]);
    const startingId = get(profilesStore.profilesState).activeProfileId;

    // Mid-batch, the user switches to a different profile.
    adapterMock.mockImplementation(async (batch: Video[]) => {
      await profilesStore.addProfileAction("Engineering");
      return batch.map((v) => ({ videoId: v.id, score: 80, reason: "late", clickbait: false }));
    });

    await scorer.scoreFeed();

    const stored = await storage.storageGet<StoredScores>(
      storage.profileKeys(startingId).scores,
    );
    expect(stored?.scores["vid00000001"]?.score).toBe(80);
    const switchedId = get(profilesStore.profilesState).activeProfileId;
    expect(switchedId).not.toBe(startingId);
    expect(await storage.storageGet(storage.profileKeys(switchedId).scores)).toBeNull();
    // The visible score store belongs to the NEW profile now — the stale
    // run must not paint its scores over it.
    expect(get(feedStore.scores)["vid00000001"]).toBeUndefined();
  });
});
