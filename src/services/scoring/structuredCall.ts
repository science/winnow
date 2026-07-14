// One structured-output call, either provider. Internalizes the two fetch
// shapes the scorers used to duplicate: Anthropic Messages with a forced
// strict tool (browser CORS opt-in header — approved house pattern), and
// OpenAI Chat Completions with a strict json_schema response_format.
// Anticipated by TWO_PHASE_SCORING.md for translateProfile-style calls.

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

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

/** Make the call and return the schema-shaped object. Throws ProviderError
 * using the house taxonomy (retry decisions live in the caller). */
export async function structuredCall<T>(spec: StructuredCallSpec): Promise<T> {
  const anthropic = spec.provider === "anthropic";
  const label = anthropic ? "Anthropic" : "OpenAI";

  const url = anthropic ? ANTHROPIC_URL : OPENAI_URL;
  const headers: Record<string, string> = anthropic
    ? {
        "content-type": "application/json",
        "x-api-key": spec.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      }
    : {
        "content-type": "application/json",
        authorization: `Bearer ${spec.apiKey}`,
      };
  const body = anthropic
    ? JSON.stringify({
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
            input_schema: spec.schema,
          },
        ],
        tool_choice: { type: "tool", name: spec.name },
      })
    : JSON.stringify({
        model: spec.model,
        temperature: 0,
        messages: [
          { role: "system", content: spec.system },
          { role: "user", content: spec.user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: spec.name, strict: true, schema: spec.schema },
        },
      });

  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers, body });
  } catch (err) {
    throw new ProviderError("network", err instanceof Error ? err.message : "fetch failed");
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new ProviderError(
      kindFromStatus(res.status),
      `${label} HTTP ${res.status}: ${errBody.slice(0, 300)}`,
    );
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new ProviderError("bad_response", `${label} returned unparseable JSON`);
  }

  if (anthropic) {
    const content = (data as { content?: Array<{ type: string; name?: string; input?: unknown }> })
      .content;
    const toolUse = content?.find((b) => b.type === "tool_use" && b.name === spec.name);
    if (!toolUse || toolUse.input === undefined) {
      throw new ProviderError("bad_response", `Anthropic response missing ${spec.name} tool output`);
    }
    return toolUse.input as T;
  }

  const content = (data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]
    ?.message?.content;
  if (!content) throw new ProviderError("bad_response", "OpenAI response missing content");
  try {
    return JSON.parse(content) as T;
  } catch {
    throw new ProviderError("bad_response", "OpenAI content was not valid JSON");
  }
}
