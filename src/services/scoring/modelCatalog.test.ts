import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchProviderModels } from "./modelCatalog";

function stubListFetch(body: unknown, status = 200) {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(new Request(input as RequestInfo, init).url);
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return urls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchProviderModels", () => {
  it("should list Anthropic models newest first from /v1/models", async () => {
    const urls = stubListFetch({
      data: [
        { id: "claude-haiku-4-5", created_at: "2025-10-01T00:00:00Z" },
        { id: "claude-sonnet-5", created_at: "2026-02-01T00:00:00Z" },
      ],
      has_more: false,
    });
    const ids = await fetchProviderModels("anthropic", "k");
    expect(ids).toEqual(["claude-sonnet-5", "claude-haiku-4-5"]);
    expect(urls[0]).toContain("api.anthropic.com/v1/models");
  });

  it("should list filtered OpenAI gpt models from /v1/models", async () => {
    const urls = stubListFetch({
      object: "list",
      data: [
        { id: "whisper-1", created: 900 },
        { id: "gpt-5.4-mini", created: 400 },
        { id: "gpt-4.1", created: 100 },
      ],
    });
    const ids = await fetchProviderModels("openai", "k");
    expect(ids).toEqual(["gpt-5.4-mini", "gpt-4.1"]);
    expect(urls[0]).toContain("api.openai.com/v1/models");
  });

  it("should fail fast with the house error taxonomy (401 → auth, single request)", async () => {
    stubListFetch({ error: { message: "bad key" } }, 401);
    await expect(fetchProviderModels("openai", "bad")).rejects.toMatchObject({
      name: "ProviderError",
      kind: "auth",
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});
