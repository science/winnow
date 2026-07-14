// Direct browser→OpenAI call (house pattern from wolfechat's
// openaiService.ts Bearer fetch). Chat Completions with a strict
// json_schema response_format — no streaming needed for batch scoring.

import type { Profile, Video } from "../../lib/types";
import type { FeedbackExample } from "../../lib/feedback";
import { buildUserMessage, SCORES_SCHEMA, SYSTEM_PROMPT } from "./prompt";
import { kindFromStatus, ProviderError, type RawScore } from "./providerTypes";

// Cheap-model names rotate at OpenAI — review this constant periodically.
// Participates in the score-cache hash, so a swap cleanly re-scores.
export const OPENAI_MODEL = "gpt-4o-mini";

const API_URL = "https://api.openai.com/v1/chat/completions";

export async function scoreBatchOpenai(
  videos: Video[],
  profile: Profile,
  apiKey: string,
  feedback: FeedbackExample[] = [],
): Promise<RawScore[]> {
  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserMessage(videos, profile, feedback) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "score_videos", strict: true, schema: SCORES_SCHEMA },
        },
      }),
    });
  } catch (err) {
    throw new ProviderError("network", err instanceof Error ? err.message : "fetch failed");
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ProviderError(kindFromStatus(res.status), `OpenAI HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  let content: string | undefined;
  try {
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    content = data.choices?.[0]?.message?.content;
  } catch {
    throw new ProviderError("bad_response", "OpenAI returned unparseable JSON");
  }
  if (!content) throw new ProviderError("bad_response", "OpenAI response missing content");

  let scores: RawScore[] | undefined;
  try {
    scores = (JSON.parse(content) as { scores?: RawScore[] }).scores;
  } catch {
    throw new ProviderError("bad_response", "OpenAI content was not valid JSON");
  }
  if (!Array.isArray(scores)) {
    throw new ProviderError("bad_response", "OpenAI response missing scores array");
  }
  return scores;
}
