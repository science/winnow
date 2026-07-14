import { afterEach, describe, expect, it, vi } from "vitest";
import { ANTHROPIC_MODEL, scoreBatchAnthropic } from "./anthropicScorer";
import { OPENAI_MODEL, scoreBatchOpenai } from "./openaiScorer";
import type { Profile, Video } from "../../lib/types";

// The scorers own which model a batch is sent to: their exported default
// participates in the score-cache hash, and the optional override is how the
// Settings model picker threads a user choice through scoreFeed.

const profile: Profile = { moreOf: "chess", lessOf: "", updatedAt: 1 };
const video = { id: "abc123DEF45", title: "T" } as Video;

function stubProviderFetch() {
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input as RequestInfo, init);
      bodies.push((await req.json()) as Record<string, unknown>);
      const payload = req.url.includes("anthropic")
        ? JSON.stringify({ content: [{ type: "tool_use", name: "score_videos", input: { scores: [] } }] })
        : JSON.stringify({ choices: [{ message: { content: JSON.stringify({ scores: [] }) } }] });
      return new Response(payload, { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
  return bodies;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scorer model selection", () => {
  it("should default OpenAI scoring to gpt-5.4-mini", async () => {
    const bodies = stubProviderFetch();
    await scoreBatchOpenai([video], profile, "k");
    expect(OPENAI_MODEL).toBe("gpt-5.4-mini");
    expect(bodies[0]!["model"]).toBe("gpt-5.4-mini");
  });

  it("should honor a model override on the OpenAI adapter", async () => {
    const bodies = stubProviderFetch();
    await scoreBatchOpenai([video], profile, "k", [], "gpt-override");
    expect(bodies[0]!["model"]).toBe("gpt-override");
  });

  it("should default Anthropic scoring to claude-haiku-4-5", async () => {
    const bodies = stubProviderFetch();
    await scoreBatchAnthropic([video], profile, "k");
    expect(ANTHROPIC_MODEL).toBe("claude-haiku-4-5");
    expect(bodies[0]!["model"]).toBe("claude-haiku-4-5");
  });

  it("should honor a model override on the Anthropic adapter", async () => {
    const bodies = stubProviderFetch();
    await scoreBatchAnthropic([video], profile, "k", [], "claude-override");
    expect(bodies[0]!["model"]).toBe("claude-override");
  });
});
