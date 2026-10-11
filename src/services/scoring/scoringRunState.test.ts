// Integration tests for what the feed SAYS while a scoring run is in flight
// or after one fails: real stores and storage (in-memory fallback), mocked
// provider calls, transcripts, and YouTube feed loads.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import type { Video } from "../../lib/types";
import { ProviderError } from "./providerTypes";

vi.mock("./anthropicScorer", () => ({
  ANTHROPIC_MODEL: "claude-test-model",
  scoreBatchAnthropic: vi.fn(),
}));
vi.mock("./structuredCall", () => ({
  structuredCall: vi.fn(),
}));
vi.mock("../youtube/transcripts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../youtube/transcripts")>()),
  TRANSCRIPT_EXCERPT_CHARS: 3000,
  fetchTranscriptExcerpt: vi.fn(async () => ({ failure: "disabled-in-test" })),
}));
vi.mock("../youtube/feedSource", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../youtube/feedSource")>()),
  loadFeeds: vi.fn(),
  loadSubscribedChannels: vi.fn(async () => ({ channels: [], warnings: [], degraded: false })),
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

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const TARGET = {
  fields: {},
  topicsMore: { items: ["trains"], importance: 8 },
  topicsLess: null,
  formatsAvoid: null,
  tonesAvoid: null,
};

/** A well-formed digest for every video the enrichment message names. */
function digestsFor(user: string): { digests: unknown[] } {
  const ids = [...user.matchAll(/"videoId": "([^"]+)"/g)].map((m) => m[1]);
  return {
    digests: ids.map((videoId) => ({
      videoId,
      summary: "s",
      topics: ["trains"],
      subjectTiers: [],
      format: "explainer",
      emotionalTone: "calm",
      hypeSignals: [],
      substanceDensity: 4,
      clickbaitSeverity: 1,
      claimOverreach: 1,
      intellectualDemand: 3,
      productionEffort: 3,
      novelty: 3,
    })),
  };
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 1));
  expect(check()).toBe(true);
}

/** Seed a configured install whose stored feed is fresh (so initFeed never
 * refetches), with the given strategy, and return the live modules. */
async function boot(videoIds: string[], scoringStrategy: "direct" | "two-phase") {
  const storage = await import("../../lib/storage");
  await storage.storageSet(storage.KEYS.videos, {
    fetchedAt: Date.now(),
    videos: videoIds.map(video),
  });
  const settingsStore = await import("../../stores/settingsStore");
  await settingsStore.settingsReady;
  settingsStore.settings.set({
    ...settingsStore.DEFAULT_SETTINGS,
    anthropicApiKey: "sk-test",
    scoringStrategy,
  });
  settingsStore.profile.update((p) => ({ ...p, moreOf: "trains", updatedAt: 1 }));

  const feedStore = await import("../../stores/feedStore");
  feedStore.videos.set(videoIds.map(video));
  const adapterMock = vi.mocked((await import("./anthropicScorer")).scoreBatchAnthropic);
  adapterMock.mockReset();
  const callMock = vi.mocked((await import("./structuredCall")).structuredCall);
  callMock.mockReset();
  const loadFeedsMock = vi.mocked((await import("../youtube/feedSource")).loadFeeds);
  loadFeedsMock.mockReset();
  const scorer = await import("./scorer");
  return { storage, feedStore, scorer, adapterMock, callMock, loadFeedsMock };
}

describe("scoring run state", () => {
  it("should keep showing an in-flight run as scoring when the feed page remounts mid-run", async () => {
    const { feedStore, scorer, adapterMock } = await boot(["vid00000001"], "direct");
    const gate = deferred();
    adapterMock.mockImplementation(async (batch: Video[]) => {
      await gate.promise;
      return batch.map((v) => ({ videoId: v.id, score: 80, reason: "ok", clickbait: false }));
    });

    const run = scorer.scoreFeed();
    await until(() => adapterMock.mock.calls.length > 0);
    // Settings → Feed remounts the feed component, which re-runs initFeed.
    await feedStore.initFeed();

    expect(get(feedStore.status).phase).toBe("scoring");
    gate.resolve();
    await run;
    expect(get(feedStore.status).phase).toBe("idle");
  });

  it("should keep showing an in-flight run as scoring when a refresh lands mid-run", async () => {
    const { feedStore, scorer, adapterMock, loadFeedsMock } = await boot(["vid00000001"], "direct");
    loadFeedsMock.mockResolvedValue({
      videos: [video("vid00000001"), video("vid00000002")],
      warnings: [],
      signedOut: false,
    });
    const gate = deferred();
    adapterMock.mockImplementation(async (batch: Video[]) => {
      await gate.promise;
      return batch.map((v) => ({ videoId: v.id, score: 80, reason: "ok", clickbait: false }));
    });

    const run = scorer.scoreFeed();
    await until(() => adapterMock.mock.calls.length > 0);
    await feedStore.refresh();

    expect(get(feedStore.status).phase).toBe("scoring");
    gate.resolve();
    await run;
  });

  it("should not leave the feed showing scoring after a run that had nothing to do", async () => {
    const { feedStore, scorer, adapterMock, loadFeedsMock } = await boot(["vid00000001"], "direct");
    adapterMock.mockImplementation(async (batch: Video[]) =>
      batch.map((v) => ({ videoId: v.id, score: 80, reason: "ok", clickbait: false })),
    );
    await scorer.scoreFeed();
    // Second run: everything cached, the run returns without scoring. A
    // refresh racing it must not inherit a "scoring" phase nobody will clear.
    loadFeedsMock.mockResolvedValue({ videos: [video("vid00000001")], warnings: [], signedOut: false });
    await Promise.all([scorer.scoreFeed(), feedStore.refresh()]);

    expect(get(feedStore.status).phase).toBe("idle");
  });

  it("should say why videos stayed unvetted when the provider rejects every call", async () => {
    const { feedStore, scorer, callMock } = await boot(["vid00000001", "vid00000002"], "two-phase");
    callMock.mockRejectedValue(
      new ProviderError("bad_request", "Anthropic HTTP 400: Your credit balance is too low"),
    );

    await scorer.scoreFeed();

    const status = get(feedStore.status);
    expect(status.phase).toBe("idle");
    expect(status.scoringFailure).toMatch(/2 videos.*credit balance is too low/);
  });

  it("should clear the reason once a later run vets everything", async () => {
    const { feedStore, scorer, callMock } = await boot(["vid00000001"], "two-phase");
    callMock.mockRejectedValueOnce(new ProviderError("bad_request", "Anthropic HTTP 400: nope"));
    await scorer.scoreFeed();
    expect(get(feedStore.status).scoringFailure).not.toBeNull();

    callMock.mockImplementation(async (spec: { name: string; user: string }) =>
      spec.name === "translate_profile" ? TARGET : digestsFor(spec.user),
    );
    await scorer.scoreFeed();

    expect(get(feedStore.status).scoringFailure).toBeNull();
    expect(get(feedStore.scores)["vid00000001"]).toBeDefined();
  });

  it("should say why some videos stayed unvetted when enrichment batches fail", async () => {
    const { feedStore, scorer, callMock } = await boot(["vid00000001"], "two-phase");
    callMock.mockImplementation(async (spec: { name: string }) => {
      if (spec.name === "translate_profile") return TARGET;
      throw new ProviderError("bad_response", "Anthropic response missing digest_videos tool output");
    });

    await scorer.scoreFeed();

    expect(get(feedStore.status).scoringFailure).toMatch(
      /1 video .*missing digest_videos tool output/,
    );
  });
});
