import { describe, expect, it } from "vitest";
import { filterOpenaiModels, sortAnthropicModels } from "./modelFilter";

describe("filterOpenaiModels", () => {
  it("should keep only gpt chat models, newest first", () => {
    const ids = filterOpenaiModels([
      { id: "gpt-4o-mini", created: 100 },
      { id: "gpt-5.4-mini", created: 400 },
      { id: "gpt-5.4", created: 390 },
      { id: "dall-e-3", created: 500 },
      { id: "text-embedding-3-small", created: 500 },
      { id: "whisper-1", created: 500 },
      { id: "gpt-4o-mini-tts", created: 500 },
      { id: "gpt-4o-realtime-preview", created: 500 },
      { id: "gpt-4o-audio-preview", created: 500 },
      { id: "gpt-image-1", created: 500 },
      { id: "gpt-4o-transcribe", created: 500 },
      { id: "omni-moderation-latest", created: 500 },
      { id: "gpt-4o-search-preview", created: 500 },
    ]);
    expect(ids).toEqual(["gpt-5.4-mini", "gpt-5.4", "gpt-4o-mini"]);
  });

  it("should dedupe and tolerate missing created timestamps", () => {
    const ids = filterOpenaiModels([
      { id: "gpt-5.4-mini" },
      { id: "gpt-5.4-mini" },
      { id: "gpt-4.1", created: 10 },
    ]);
    expect(ids).toEqual(["gpt-4.1", "gpt-5.4-mini"]);
  });
});

describe("sortAnthropicModels", () => {
  it("should keep claude models, newest first", () => {
    const ids = sortAnthropicModels([
      { id: "claude-haiku-4-5", created_at: "2025-10-01T00:00:00Z" },
      { id: "claude-sonnet-5", created_at: "2026-02-01T00:00:00Z" },
      { id: "claude-3-5-haiku-20241022", created_at: "2024-10-22T00:00:00Z" },
    ]);
    expect(ids).toEqual(["claude-sonnet-5", "claude-haiku-4-5", "claude-3-5-haiku-20241022"]);
  });

  it("should drop non-claude ids defensively", () => {
    expect(sortAnthropicModels([{ id: "weird-internal-model" }, { id: "claude-sonnet-5" }])).toEqual([
      "claude-sonnet-5",
    ]);
  });
});
