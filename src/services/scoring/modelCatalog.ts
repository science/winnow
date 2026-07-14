// Boundary: enumerate each provider's available models for the Settings
// picker (wolfechat pattern). User-initiated refresh — fail fast, no retry
// (maxRetries: 0 keeps the SDKs from retrying behind our back), errors mapped
// onto the house ProviderError taxonomy.

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { filterOpenaiModels, sortAnthropicModels } from "../../lib/modelFilter";
import type { Provider } from "../../lib/types";
import { toProviderError } from "./structuredCall";

/** Fetch and shape the model list for one provider, newest first. */
export async function fetchProviderModels(provider: Provider, apiKey: string): Promise<string[]> {
  if (provider === "anthropic") {
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0 });
    try {
      const page = await client.models.list({ limit: 1000 });
      return sortAnthropicModels(page.data);
    } catch (err) {
      throw toProviderError(err, "Anthropic");
    }
  }
  const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0 });
  try {
    const page = await client.models.list();
    return filterOpenaiModels(page.data);
  } catch (err) {
    throw toProviderError(err, "OpenAI");
  }
}
