// OpenAI score adapter: a thin wrapper over structuredCall (which owns the
// Bearer fetch + strict json_schema response_format shape).

import type { Profile, Video } from "../../lib/types";
import type { FeedbackExample } from "../../lib/feedback";
import { buildUserMessage, SCORES_SCHEMA, SYSTEM_PROMPT } from "./prompt";
import { ProviderError, type RawScore } from "./providerTypes";
import { structuredCall } from "./structuredCall";

// Cheap-model names rotate at OpenAI — review this constant periodically.
// Participates in the score-cache hash, so a swap cleanly re-scores.
export const OPENAI_MODEL = "gpt-5.4-mini";

export async function scoreBatchOpenai(
  videos: Video[],
  profile: Profile,
  apiKey: string,
  feedback: FeedbackExample[] = [],
  model: string = OPENAI_MODEL,
): Promise<RawScore[]> {
  const result = await structuredCall<{ scores?: RawScore[] }>({
    provider: "openai",
    apiKey,
    model,
    system: SYSTEM_PROMPT,
    user: buildUserMessage(videos, profile, feedback),
    schema: SCORES_SCHEMA,
    name: "score_videos",
  });
  if (!Array.isArray(result.scores)) {
    throw new ProviderError("bad_response", "OpenAI response missing scores array");
  }
  return result.scores;
}
