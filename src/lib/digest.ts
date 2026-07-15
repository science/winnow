// Pure validation/normalization of phase-1 enrichment digests. Providers
// return schema-shaped JSON, but strict schemas can't express numeric
// bounds or controlled vocabularies — those are enforced here.

import { DIGEST_NUMERIC_FIELDS, type VideoDigest } from "./types";

export const DIGEST_FORMATS = [
  "tutorial",
  "explainer",
  "essay",
  "documentary",
  "news",
  "review",
  "interview",
  "vlog",
  "reaction",
  "entertainment",
  "highlights",
  "other",
] as const;

export const DIGEST_TONES = [
  "calm",
  "enthusiastic",
  "humorous",
  "dramatic",
  "urgent",
  "outraged",
  "neutral",
] as const;

/** Canonical tier/style qualifiers for topic tags ("elite chess", "comedic
 * chess"). The translator and the enricher are independent LLM calls whose
 * qualified tags must token-match each other — free-choice qualifiers don't
 * ("top tier chess" vs "elite chess"), so both prompts interpolate this
 * exact list. */
export const DIGEST_TIER_QUALIFIERS = [
  "elite",
  "professional",
  "amateur",
  "beginner",
  "comedic",
  "casual",
] as const;

export const SUMMARY_MAX_CHARS = 400;
export const TOPICS_MAX = 8;

function cleanStrings(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, max);
}

/** Normalize one raw digest: clamp numerics to integer 1-5, lowercase and cap
 * lists, coerce format/tone onto the controlled vocabulary. Null when a
 * required numeric axis is absent — that digest is unusable for ranking. */
export function clampDigest(raw: unknown): VideoDigest | null {
  if (raw === null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const numerics: Partial<Record<(typeof DIGEST_NUMERIC_FIELDS)[number], number>> = {};
  for (const field of DIGEST_NUMERIC_FIELDS) {
    const v = obj[field];
    if (typeof v !== "number" || Number.isNaN(v)) return null;
    numerics[field] = Math.max(1, Math.min(5, Math.round(v)));
  }

  const format = String(obj["format"] ?? "").trim().toLowerCase();
  const tone = String(obj["emotionalTone"] ?? "").trim().toLowerCase();
  return {
    ...(numerics as Record<(typeof DIGEST_NUMERIC_FIELDS)[number], number>),
    summary: typeof obj["summary"] === "string" ? obj["summary"].slice(0, SUMMARY_MAX_CHARS) : "",
    topics: cleanStrings(obj["topics"], TOPICS_MAX),
    format: (DIGEST_FORMATS as readonly string[]).includes(format) ? format : "other",
    emotionalTone: (DIGEST_TONES as readonly string[]).includes(tone) ? tone : "neutral",
    hypeSignals: cleanStrings(obj["hypeSignals"], 8),
  };
}
