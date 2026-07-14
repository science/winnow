// Direct browser→Anthropic Messages API call (house pattern from
// gcal-timeslot-generator's anthropic-api.ts): the user's own key, stored
// locally, sent straight to Anthropic with the CORS opt-in header. A forced
// strict tool guarantees schema-valid JSON (strict tool use is GA — no beta
// header). Score bounds are clamped in scorer.ts since strict schemas
// reject numeric min/max.

import type { Profile, Video } from "../../lib/types";
import { buildUserMessage, SCORES_SCHEMA, SYSTEM_PROMPT } from "./prompt";
import { kindFromStatus, ProviderError, type RawScore } from "./providerTypes";

// Cheapest current Anthropic model — right tier for high-volume metadata
// scoring. Participates in the score-cache hash, so changing it cleanly
// invalidates and re-scores.
export const ANTHROPIC_MODEL = "claude-haiku-4-5";

const API_URL = "https://api.anthropic.com/v1/messages";

export async function scoreBatchAnthropic(
  videos: Video[],
  profile: Profile,
  apiKey: string,
): Promise<RawScore[]> {
  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 4096,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserMessage(videos, profile) }],
        tools: [
          {
            name: "score_videos",
            description: "Report the score for every video in the batch.",
            strict: true,
            input_schema: SCORES_SCHEMA,
          },
        ],
        tool_choice: { type: "tool", name: "score_videos" },
      }),
    });
  } catch (err) {
    throw new ProviderError("network", err instanceof Error ? err.message : "fetch failed");
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ProviderError(kindFromStatus(res.status), `Anthropic HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new ProviderError("bad_response", "Anthropic returned unparseable JSON");
  }

  const content = (data as { content?: Array<{ type: string; name?: string; input?: unknown }> }).content;
  const toolUse = content?.find((b) => b.type === "tool_use" && b.name === "score_videos");
  const scores = (toolUse?.input as { scores?: RawScore[] } | undefined)?.scores;
  if (!Array.isArray(scores)) {
    throw new ProviderError("bad_response", "Anthropic response missing score_videos tool output");
  }
  return scores;
}
