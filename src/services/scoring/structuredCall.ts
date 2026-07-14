// One structured-output call, either provider, via the official SDKs:
// Anthropic Messages with a forced strict tool (dangerouslyAllowBrowser is
// the approved house pattern for BYO-key client-only apps), and OpenAI Chat
// Completions with a strict json_schema response_format.
//
// maxRetries: 0 is load-bearing on both clients — the SDKs default to two
// internal retries on 429/5xx, which would stack on the single house retry
// in scorer.ts. All retry decisions live in the caller.

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { Provider } from "../../lib/types";
import { kindFromStatus, ProviderError } from "./providerTypes";

export interface StructuredCallSpec {
  provider: Provider;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  /** Strict schema: additionalProperties false, every field required. */
  schema: object;
  /** Tool name (Anthropic) / json_schema name (OpenAI). */
  name: string;
  maxTokens?: number;
}

/** Map an SDK failure onto the house error taxonomy. Both SDKs expose the
 * same error shapes: APIConnectionError (network) and APIError (.status). */
function toProviderError(err: unknown, label: string): ProviderError {
  if (err instanceof Anthropic.APIConnectionError || err instanceof OpenAI.APIConnectionError) {
    return new ProviderError("network", `${label}: ${err.message}`);
  }
  if (err instanceof Anthropic.APIError || err instanceof OpenAI.APIError) {
    const status = typeof err.status === "number" ? err.status : 0;
    return new ProviderError(kindFromStatus(status), `${label} HTTP ${status}: ${err.message.slice(0, 300)}`);
  }
  return new ProviderError("bad_response", `${label}: ${err instanceof Error ? err.message : String(err)}`);
}

/** Make the call and return the schema-shaped object. Throws ProviderError
 * using the house taxonomy (retry decisions live in the caller). */
export async function structuredCall<T>(spec: StructuredCallSpec): Promise<T> {
  if (spec.provider === "anthropic") {
    const client = new Anthropic({
      apiKey: spec.apiKey,
      dangerouslyAllowBrowser: true,
      maxRetries: 0,
    });
    let message: Anthropic.Message;
    try {
      message = await client.messages.create({
        model: spec.model,
        max_tokens: spec.maxTokens ?? 4096,
        temperature: 0,
        system: spec.system,
        messages: [{ role: "user", content: spec.user }],
        tools: [
          {
            name: spec.name,
            description: "Report the structured result.",
            strict: true,
            input_schema: spec.schema as Anthropic.Tool["input_schema"],
          } as Anthropic.Tool,
        ],
        tool_choice: { type: "tool", name: spec.name },
      });
    } catch (err) {
      throw toProviderError(err, "Anthropic");
    }
    // A 200 with a non-JSON body reaches here as a non-message value — treat
    // any shape surprise as bad_response, never a crash.
    const blocks = (message as { content?: Anthropic.ContentBlock[] })?.content;
    const toolUse = Array.isArray(blocks)
      ? blocks.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === spec.name)
      : undefined;
    if (!toolUse || toolUse.input === undefined) {
      throw new ProviderError("bad_response", `Anthropic response missing ${spec.name} tool output`);
    }
    return toolUse.input as T;
  }

  const client = new OpenAI({
    apiKey: spec.apiKey,
    dangerouslyAllowBrowser: true,
    maxRetries: 0,
  });
  let completion: OpenAI.Chat.Completions.ChatCompletion;
  try {
    // No temperature: the gpt-5.x family rejects non-default sampling params.
    completion = await client.chat.completions.create({
      model: spec.model,
      messages: [
        { role: "system", content: spec.system },
        { role: "user", content: spec.user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: spec.name, strict: true, schema: spec.schema as Record<string, unknown> },
      },
    });
  } catch (err) {
    throw toProviderError(err, "OpenAI");
  }
  const content = (completion as { choices?: Array<{ message?: { content?: string | null } }> })
    ?.choices?.[0]?.message?.content;
  if (!content) throw new ProviderError("bad_response", "OpenAI response missing content");
  try {
    return JSON.parse(content) as T;
  } catch {
    throw new ProviderError("bad_response", "OpenAI content was not valid JSON");
  }
}
