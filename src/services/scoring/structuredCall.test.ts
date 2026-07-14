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

// The SDKs may call fetch(url, init) or fetch(Request); normalize both so
// assertions don't depend on SDK internals.
function stubFetch(responder: (req: Request) => Response | Promise<Response>) {
  const requests: Request[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input as RequestInfo, init);
    requests.push(req.clone());
    return responder(req);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, requests };
}

/** 200 response the SDKs will JSON-parse (they key off Content-Type). */
function jsonResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("structuredCall", () => {
  it("should parse a forced-tool Anthropic response", async () => {
    stubFetch(() => jsonResponse(anthropicBody));
    const result = await structuredCall<{ answer: string }>(spec("anthropic"));
    expect(result.answer).toBe("hi from anthropic");
  });

  it("should parse an OpenAI json_schema response", async () => {
    stubFetch(() => jsonResponse(openaiBody));
    const result = await structuredCall<{ answer: string }>(spec("openai"));
    expect(result.answer).toBe("hi from openai");
  });

  it("should hit the real provider endpoints with the right auth headers", async () => {
    const { requests } = stubFetch((req) =>
      req.url.includes("anthropic")
        ? jsonResponse(anthropicBody)
        : jsonResponse(openaiBody),
    );
    await structuredCall(spec("anthropic"));
    await structuredCall(spec("openai"));

    const [anthropicReq, openaiReq] = requests as [Request, Request];
    expect(anthropicReq.url).toContain("api.anthropic.com/v1/messages");
    expect(anthropicReq.headers.get("x-api-key")).toBe("test-key");
    expect(anthropicReq.headers.get("anthropic-dangerous-direct-browser-access")).toBe("true");

    expect(openaiReq.url).toContain("api.openai.com/v1/chat/completions");
    expect(openaiReq.headers.get("authorization")).toBe("Bearer test-key");
    expect(openaiReq.headers.get("anthropic-dangerous-direct-browser-access")).toBeNull();
  });

  it("should send a forced strict tool to Anthropic and json_schema to OpenAI", async () => {
    const { requests } = stubFetch((req) =>
      req.url.includes("anthropic")
        ? jsonResponse(anthropicBody)
        : jsonResponse(openaiBody),
    );
    await structuredCall(spec("anthropic"));
    await structuredCall(spec("openai"));

    const anthropicPayload = await requests[0]!.json();
    expect(anthropicPayload.model).toBe("test-model");
    expect(anthropicPayload.tool_choice).toEqual({ type: "tool", name: "answer_tool" });
    expect(anthropicPayload.tools[0].input_schema).toEqual(SCHEMA);

    const openaiPayload = await requests[1]!.json();
    expect(openaiPayload.model).toBe("test-model");
    expect(openaiPayload.response_format.type).toBe("json_schema");
    expect(openaiPayload.response_format.json_schema.strict).toBe(true);
  });

  it("should not send temperature to OpenAI (gpt-5.x models reject non-default sampling)", async () => {
    const { requests } = stubFetch(() => jsonResponse(openaiBody));
    await structuredCall(spec("openai"));
    const payload = await requests[0]!.json();
    expect(payload.temperature).toBeUndefined();
  });

  it("should never retry internally — one 500 means one request and a server error (house retry lives in scorer.ts)", async () => {
    const { fetchMock } = stubFetch(() => new Response("boom", { status: 500 }));
    await expect(structuredCall(spec("openai"))).rejects.toMatchObject({
      name: "ProviderError",
      kind: "server",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("should map 401 to an auth ProviderError", async () => {
    stubFetch(() => new Response("nope", { status: 401 }));
    await expect(structuredCall(spec("anthropic"))).rejects.toMatchObject({
      name: "ProviderError",
      kind: "auth",
    });
  });

  it("should map 429 to a rate ProviderError without internal retries", async () => {
    const { fetchMock } = stubFetch(() => new Response("slow down", { status: 429 }));
    await expect(structuredCall(spec("anthropic"))).rejects.toMatchObject({
      name: "ProviderError",
      kind: "rate",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("should fail fast with bad_response on unparseable bodies", async () => {
    stubFetch(() => new Response("not json {", { status: 200 }));
    await expect(structuredCall(spec("openai"))).rejects.toMatchObject({
      name: "ProviderError",
      kind: "bad_response",
    });
  });

  it("should throw a network ProviderError when fetch itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("connection refused");
      }),
    );
    await expect(structuredCall(spec("anthropic"))).rejects.toMatchObject({
      name: "ProviderError",
      kind: "network",
    });
  });

  it("should reject an Anthropic response missing the forced tool output", async () => {
    stubFetch(() => jsonResponse(JSON.stringify({ content: [] })));
    await expect(structuredCall(spec("anthropic"))).rejects.toBeInstanceOf(ProviderError);
  });
});
