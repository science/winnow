// Phase-1 prompt: turn one batch of videos (metadata + full transcript when
// available) into profile-independent digests on a cheap model. The
// controlled vocabulary and every axis's poles are described explicitly
// (movie-night taxonomy pattern) — vague axes produce noise, not signal.

import type { Video } from "../../lib/types";
import { DIGEST_FORMATS, DIGEST_TONES } from "../../lib/digest";

// Bump on any prompt or schema change — participates in the enrichment
// cache key, so a bump cleanly re-enriches everything.
export const ENRICHMENT_PROMPT_VERSION = 2;

/** Full transcripts are big; batches stay small so a batch fits comfortably
 * in a cheap model's context and one failure loses little. */
export const ENRICH_BATCH_SIZE = 4;

/** Transcript cap per video in the enrichment prompt (~5k tokens ≈ 25 min
 * of speech). Enough to judge whether claims outrun the evidence. */
export const ENRICH_TRANSCRIPT_CHARS = 20000;

export interface EnrichInput {
  video: Video;
  /** Full transcript text (pre-cap), null when the video has none. */
  transcript: string | null;
}

export const ENRICH_SYSTEM_PROMPT = `You analyze YouTube videos for a personal curation engine. For each video you receive metadata and, usually, the transcript (possibly truncated). Produce a digest of what the video actually is — independent of anyone's taste. Your digest will later be ranked against a person's interest profile, so accuracy beats charity.

The transcript is ground truth: it is what the video actually says, while the title, thumbnail and description are marketing. When they disagree, believe the transcript. Without a transcript, judge from metadata alone and stay near the middle (3) on axes you cannot verify.

Fields per video:
- summary: 1-2 plain sentences on what the video contains and argues. No hype words, no marketing language.
- topics: up to 8 lowercase tags, broad to specific (e.g. "chess", "rook endgames"). When the level, tier, or style of the subject is clearly identifiable, include a qualified tag for it too (e.g. "comic chess", "elite chess", "beginner tutorial", "amateur game recap") — profiles often seek or avoid a specific tier of a subject, and a bare tag cannot express that.
- format: one of ${DIGEST_FORMATS.join(", ")}.
- emotionalTone: one of ${DIGEST_TONES.join(", ")}.
- hypeSignals: concrete manipulation techniques you actually observed ("withheld subject in title", "manufactured urgency", "outrage framing", "teaser never resolved"). Empty array when clean.
- substanceDensity 1-5: 5 = information-dense, leaves the viewer with concrete understanding per minute spent; 1 = padding, repetition, filler stretched over runtime.
- clickbaitSeverity 1-5: packaging honesty. 5 = title/thumbnail promise something the content does not deliver; 1 = packaging matches content.
- claimOverreach 1-5: compare the claims made against the evidence and reasoning actually shown. 1 = claims carefully qualified and supported. 5 = sensational, contrarian, or mysterious claims stated as fact beyond their support — the science-provocateur pattern: dramatic counterintuitive assertions, single results generalized to everything, mystery manufactured where a mundane explanation exists. A polished, entertaining, mostly-factual video still scores 4-5 here if its headline thesis overstates what it demonstrates.
- intellectualDemand 1-5: 1 = background watching; 5 = needs focused attention or prior knowledge.
- productionEffort 1-5: research, editing, original footage vs. reading tweets over stock clips.
- novelty 1-5: 5 = an angle rarely covered; 1 = the thousandth take on a beaten topic.

All numeric axes are integers. Return exactly one digest per input video, tagged with its videoId.`;

const digestItemSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "videoId",
    "summary",
    "topics",
    "format",
    "emotionalTone",
    "hypeSignals",
    "substanceDensity",
    "clickbaitSeverity",
    "claimOverreach",
    "intellectualDemand",
    "productionEffort",
    "novelty",
  ],
  properties: {
    videoId: { type: "string" },
    summary: { type: "string" },
    topics: { type: "array", items: { type: "string" } },
    format: { type: "string", enum: [...DIGEST_FORMATS] },
    emotionalTone: { type: "string", enum: [...DIGEST_TONES] },
    hypeSignals: { type: "array", items: { type: "string" } },
    substanceDensity: { type: "integer" },
    clickbaitSeverity: { type: "integer" },
    claimOverreach: { type: "integer" },
    intellectualDemand: { type: "integer" },
    productionEffort: { type: "integer" },
    novelty: { type: "integer" },
  },
} as const;

export const DIGESTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["digests"],
  properties: {
    digests: { type: "array", items: digestItemSchema },
  },
} as const;

export function buildEnrichMessage(inputs: EnrichInput[]): string {
  const items = inputs.map(({ video: v, transcript }) => ({
    videoId: v.id,
    title: v.title,
    channel: v.channelTitle ?? "unknown",
    duration: v.durationText ?? "unknown",
    age: v.publishedText ?? "unknown",
    views: v.viewCountText ?? "unknown",
    source: v.source,
    ...(v.descriptionSnippet ? { description: v.descriptionSnippet.slice(0, 500) } : {}),
    ...(transcript ? { transcript: transcript.slice(0, ENRICH_TRANSCRIPT_CHARS) } : {}),
  }));
  return ["<videos>", JSON.stringify(items, null, 1), "</videos>"].join("\n");
}
