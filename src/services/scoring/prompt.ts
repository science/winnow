import type { Profile, Video } from "../../lib/types";
import type { FeedbackExample } from "../../lib/feedback";

// Bump whenever the system prompt or output schema changes — it participates
// in the score-cache hash, so a bump cleanly re-scores everything.
// v2: user feedback examples (Good pick / Not for me votes) in the prompt.
export const PROMPT_VERSION = 2;

export const BATCH_SIZE = 20;

/** Most-recent votes per direction included in each scoring call. The
 * feedback store holds up to 200 entries; the prompt sees only these. */
export const FEEDBACK_PROMPT_CAP = 10;

export const SYSTEM_PROMPT = `You curate a YouTube feed for one person. You will receive their interest profile (what they want more of and less of) and a batch of videos with metadata (title, channel, duration, age, view count, source, and sometimes a description snippet or transcript excerpt). When a transcript excerpt is present, weigh it heavily — it reveals whether the content delivers on the title's promise.

Score each video 0-100 for how likely watching it leaves this person genuinely satisfied and enriched afterward — not how likely they are to click it. Reward substance that matches the profile. Penalize clickbait, engagement bait, manufactured outrage, and titles or framing that overpromise (withheld subject, "you won't believe", all-caps hype, fear-mongering thumbnails). A video can be squarely on-topic for the profile and still be clickbait — score it accordingly and set the clickbait flag.

Source "home" means YouTube's recommendation algorithm chose it (be more skeptical of engagement optimization); "subscriptions" means the person chose to follow this channel.

You may also receive a feedback section: videos the person personally rated ("up" = good pick, "down" = not for me). Treat those verdicts as strong evidence of taste — generalize the pattern behind them, not the single video.

Calibration: 80-100 clearly worth their time; 50-79 plausibly worth it; 0-49 skip. Use the full range — differentiate.

For each video return: videoId, score, a reason of at most 120 characters written directly to the user explaining the score, and a clickbait boolean.`;

// One schema shared by both providers. Kept minimal: Anthropic strict
// structured outputs reject numeric min/max, so bounds are clamped
// client-side in scorer.ts instead.
export const SCORES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["scores"],
  properties: {
    scores: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["videoId", "score", "reason", "clickbait"],
        properties: {
          videoId: { type: "string" },
          score: { type: "integer" },
          reason: { type: "string" },
          clickbait: { type: "boolean" },
        },
      },
    },
  },
} as const;

export function buildUserMessage(
  videos: Video[],
  profile: Profile,
  feedback: FeedbackExample[] = [],
): string {
  const items = videos.map((v) => ({
    videoId: v.id,
    title: v.title,
    channel: v.channelTitle ?? "unknown",
    duration: v.durationText ?? (v.isLive ? "live now" : "unknown"),
    age: v.publishedText ?? "unknown",
    views: v.viewCountText ?? "unknown",
    source: v.source,
    ...(v.descriptionSnippet ? { description: v.descriptionSnippet.slice(0, 500) } : {}),
    ...(v.transcriptExcerpt ? { transcript: v.transcriptExcerpt } : {}),
  }));
  const feedbackBlock =
    feedback.length > 0
      ? [
          "<feedback>",
          'The person rated these videos themselves ("up" = good pick, "down" = not for me).',
          "Treat them as strong evidence of taste; generalize the pattern, not the single video.",
          JSON.stringify(feedback, null, 1),
          "</feedback>",
          "",
        ]
      : [];
  return [
    "<profile>",
    `More of this: ${profile.moreOf.trim() || "(not specified)"}`,
    `Less of this: ${profile.lessOf.trim() || "(not specified)"}`,
    "</profile>",
    "",
    ...feedbackBlock,
    `Score these ${items.length} videos:`,
    JSON.stringify(items, null, 1),
  ].join("\n");
}
