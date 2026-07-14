import { afterEach, describe, expect, it, vi } from "vitest";
import { structuredCall, type StructuredCallSpec } from "./structuredCall";
import { ProviderError } from "./providerTypes";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer"],
  properties: { answer: { type: "string" } },
} as const;

function spec(provider: "anthropic" | "openai"): StructuredCallSpec {
  return {
    provider,
    apiKey: "test-key",
    model: "test-model",
    system: "You answer.",
    user: "Say hi.",
    schema: SCHEMA,
    name: "answer_tool",
  };
}

const anthropicBody = JSON.stringify({
  content: [{ type: "tool_use", name: "answer_tool", input: { answer: "hi from anthropic" } }],
});

const openaiBody = JSON.stringify({
  choices: [{ message: { content: JSON.stringify({ answer: "hi from openai" }) } }],
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("structuredCall", () => {
  it("should parse a forced-tool Anthropic response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(anthropicBody, { status: 200 })));
    const result = await structuredCall<{ answer: string }>(spec("anthropic"));
    expect(result.answer).toBe("hi from anthropic");
  });

  it("should parse an OpenAI json_schema response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(openaiBody, { status: 200 })));
    const result = await structuredCall<{ answer: string }>(spec("openai"));
    expect(result.answer).toBe("hi from openai");
  });

  it("should send the CORS opt-in header only to Anthropic", async () => {
    const fetchMock = vi.fn(async () => new Response(anthropicBody, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await structuredCall(spec("anthropic"));
    const anthropicHeaders = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    expect((anthropicHeaders.headers as Record<string, string>)["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect((anthropicHeaders.headers as Record<string, string>)["x-api-key"]).toBe("test-key");

    fetchMock.mockResolvedValue(new Response(openaiBody, { status: 200 }));
    await structuredCall(spec("openai"));
    const openaiHeaders = (fetchMock.mock.calls[1] as unknown[])[1] as RequestInit;
    expect((openaiHeaders.headers as Record<string, string>)["anthropic-dangerous-direct-browser-access"]).toBeUndefined();
    expect((openaiHeaders.headers as Record<string, string>)["authorization"]).toBe("Bearer test-key");
  });

  it("should map 401 to an auth ProviderError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    await expect(structuredCall(spec("anthropic"))).rejects.toMatchObject({
      name: "ProviderError",
      kind: "auth",
    });
  });

  it("should fail fast with bad_response on unparseable bodies", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not json {", { status: 200 })));
    await expect(structuredCall(spec("openai"))).rejects.toMatchObject({
      name: "ProviderError",
      kind: "bad_response",
    });
  });

  it("should throw a network ProviderError when fetch itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("connection refused"); }));
    await expect(structuredCall(spec("anthropic"))).rejects.toMatchObject({
      name: "ProviderError",
      kind: "network",
    });
  });

  it("should reject an Anthropic response missing the forced tool output", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ content: [] }), { status: 200 })));
    await expect(structuredCall(spec("anthropic"))).rejects.toBeInstanceOf(ProviderError);
  });
});
