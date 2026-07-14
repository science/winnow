// Anthropic score adapter: a thin wrapper over structuredCall (which owns
// the browser→Anthropic fetch shape, CORS opt-in header included). Score
// bounds are clamped in scorer.ts since strict schemas reject numeric
// min/max.

import type { Profile, Video } from "../../lib/types";
import type { FeedbackExample } from "../../lib/feedback";
import { buildUserMessage, SCORES_SCHEMA, SYSTEM_PROMPT } from "./prompt";
import { ProviderError, type RawScore } from "./providerTypes";
import { structuredCall } from "./structuredCall";

// Cheapest current Anthropic model — right tier for high-volume metadata
// scoring. Participates in the score-cache hash, so changing it cleanly
// invalidates and re-scores.
export const ANTHROPIC_MODEL = "claude-haiku-4-5";

export async function scoreBatchAnthropic(
  videos: Video[],
  profile: Profile,
  apiKey: string,
  feedback: FeedbackExample[] = [],
): Promise<RawScore[]> {
  const result = await structuredCall<{ scores?: RawScore[] }>({
    provider: "anthropic",
    apiKey,
    model: ANTHROPIC_MODEL,
    system: SYSTEM_PROMPT,
    user: buildUserMessage(videos, profile, feedback),
    schema: SCORES_SCHEMA,
    name: "score_videos",
  });
  if (!Array.isArray(result.scores)) {
    throw new ProviderError("bad_response", "Anthropic response missing scores array");
  }
  return result.scores;
}
