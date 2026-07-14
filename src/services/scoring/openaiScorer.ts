// OpenAI score adapter: a thin wrapper over structuredCall (which owns the
// Bearer fetch + strict json_schema response_format shape).

import type { Profile, Video } from "../../lib/types";
import type { FeedbackExample } from "../../lib/feedback";
import { buildUserMessage, SCORES_SCHEMA, SYSTEM_PROMPT } from "./prompt";
import { ProviderError, type RawScore } from "./providerTypes";
import { structuredCall } from "./structuredCall";

// Cheap-model names rotate at OpenAI — review this constant periodically.
// Participates in the score-cache hash, so a swap cleanly re-scores.
export const OPENAI_MODEL = "gpt-4o-mini";

export async function scoreBatchOpenai(
  videos: Video[],
  profile: Profile,
  apiKey: string,
  feedback: FeedbackExample[] = [],
): Promise<RawScore[]> {
  const result = await structuredCall<{ scores?: RawScore[] }>({
    provider: "openai",
    apiKey,
    model: OPENAI_MODEL,
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
