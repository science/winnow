// Profile suggestions from feedback: one uncached structured call that
// reads every stored vote (plus cached transcripts) and proposes full
// replacement More of / Less of texts. NOTHING applies without the user's
// explicit approval in Settings — "suggested, never silent" is a product
// rule (DESIGN.md roadmap).

import { get } from "svelte/store";
import type { FeedbackEntry, Profile, TranscriptCacheEntry } from "../../lib/types";
import { KEYS, storageGet } from "../../lib/storage";
import { feedback, feedbackReady } from "../../stores/feedbackStore";
import { profile as profileStore, settings, settingsReady } from "../../stores/settingsStore";
import { isDemoMode } from "../youtube/feedSource";
import { structuredCall } from "./structuredCall";

export const MIN_VOTES_FOR_SUGGESTION = 3;
export const SUGGEST_TRANSCRIPT_CHARS = 500;

// Rare, quality-sensitive call → stronger models than batch scoring, fixed
// here rather than following the Settings scoring-model picker (deliberate;
// user sign-off in QUESTIONS #9). Costs pennies per use.
export const SUGGEST_ANTHROPIC_MODEL = "claude-sonnet-5";
export const SUGGEST_OPENAI_MODEL = "gpt-5.4-mini";

export interface ProfileSuggestion {
  moreOf: string;
  lessOf: string;
  rationale: string;
}

export const SUGGEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["moreOf", "lessOf", "rationale"],
  properties: {
    moreOf: { type: "string" },
    lessOf: { type: "string" },
    rationale: { type: "string" },
  },
} as const;

export const SUGGEST_SYSTEM_PROMPT = `You maintain one person's YouTube interest profile: two free-text lists, "More of this" and "Less of this", that an AI uses to score their feed. You will receive the current lists and the videos the person rated themselves ("up" = good pick, "down" = not for me), sometimes with the score the AI gave at the time and a transcript excerpt.

Revise the two lists so future scoring matches the person's demonstrated taste. Preserve everything the current profile expresses unless the feedback contradicts it. Generalize the pattern behind the votes, not the single videos. Be concrete — topics, formats, channels, moods — keep the person's own voice and phrasing where possible, and keep each list compact.

Return full replacement texts for both lists, plus a short rationale (2–3 sentences, addressed directly to the person) explaining what changed and why.`;

export function buildSuggestMessage(
  profile: Profile,
  entries: FeedbackEntry[],
  transcripts: Record<string, string>,
): string {
  const items = entries.map((e) => ({
    vote: e.vote,
    title: e.title,
    channel: e.channelTitle ?? "unknown",
    duration: e.durationText ?? "unknown",
    source: e.source,
    ...(e.score !== null
      ? { scoreAtVote: e.score, reasonAtVote: e.reason, clickbaitAtVote: e.clickbait }
      : {}),
    ...(transcripts[e.videoId]
      ? { transcript: transcripts[e.videoId]!.slice(0, SUGGEST_TRANSCRIPT_CHARS) }
      : {}),
  }));
  return [
    "<current-profile>",
    `More of this: ${profile.moreOf.trim() || "(not specified)"}`,
    `Less of this: ${profile.lessOf.trim() || "(not specified)"}`,
    "</current-profile>",
    "",
    `The person rated these ${items.length} videos:`,
    JSON.stringify(items, null, 1),
    "",
    "Propose the replacement More of / Less of texts.",
  ].join("\n");
}

/** Deterministic offline stub so demo mode (and nonlive e2e) can drive the
 * whole suggest → approve flow without an AI call. */
function demoSuggestion(profile: Profile, entries: FeedbackEntry[]): ProfileSuggestion {
  const ups = entries.filter((e) => e.vote === "up").map((e) => `videos like "${e.title}"`);
  const downs = entries.filter((e) => e.vote === "down").map((e) => `videos like "${e.title}"`);
  return {
    moreOf: [profile.moreOf.trim(), ...ups].filter(Boolean).join("; "),
    lessOf: [profile.lessOf.trim(), ...downs].filter(Boolean).join("; "),
    rationale: "Demo mode: assembled directly from your votes, no AI call made.",
  };
}

/** Analyze all stored votes against the current profile and propose an
 * updated one. Throws with a friendly message when preconditions fail;
 * throws ProviderError on API failures. */
export async function suggestProfileUpdate(): Promise<ProfileSuggestion> {
  await settingsReady;
  await feedbackReady;
  const entries = Object.values(get(feedback)).sort((a, b) => b.votedAt - a.votedAt);
  if (entries.length < MIN_VOTES_FOR_SUGGESTION) {
    throw new Error(
      `Rate at least ${MIN_VOTES_FOR_SUGGESTION} videos (Good pick / Not for me) first.`,
    );
  }
  const $profile = get(profileStore);
  if (isDemoMode()) return demoSuggestion($profile, entries);

  const $settings = get(settings);
  const apiKey =
    $settings.provider === "anthropic" ? $settings.anthropicApiKey : $settings.openaiApiKey;
  if (!apiKey) throw new Error("Add an API key for your selected provider first.");

  const cache =
    (await storageGet<Record<string, TranscriptCacheEntry>>(KEYS.transcripts)) ?? {};
  const transcripts = Object.fromEntries(
    Object.entries(cache).map(([id, entry]) => [id, entry.excerpt]),
  );

  return structuredCall<ProfileSuggestion>({
    provider: $settings.provider,
    apiKey,
    model: $settings.provider === "anthropic" ? SUGGEST_ANTHROPIC_MODEL : SUGGEST_OPENAI_MODEL,
    system: SUGGEST_SYSTEM_PROMPT,
    user: buildSuggestMessage($profile, entries, transcripts),
    schema: SUGGEST_SCHEMA,
    name: "suggest_profile",
  });
}
