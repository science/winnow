// Phase-2a prompt: translate the free-text interest profile (plus the
// person's recent votes) into structured constraints over the digest
// taxonomy. One small call per profile edit — the translated target then
// ranks the whole feed locally, instantly.
//
// Strict structured outputs cannot mark fields optional, so every
// unconstrained field is emitted as null and stripped client-side by
// canonicalizeTarget (movie-night workaround).

import type { Profile } from "../../lib/types";
import type { FeedbackExample } from "../../lib/feedback";
import { DIGEST_FORMATS, DIGEST_TIER_QUALIFIERS, DIGEST_TONES } from "../../lib/digest";
import { TARGET_TOPICS_MAX } from "../../lib/rubricScorer";

// Bump on any prompt or schema change — participates in the target cache
// key, so a bump cleanly re-translates and re-ranks.
export const TRANSLATOR_PROMPT_VERSION = 4;

export const TRANSLATE_SYSTEM_PROMPT = `You translate a person's free-text YouTube interest profile into structured curation constraints. The constraints rank videos that have already been analyzed on these axes:

- substanceDensity 1-5 (5 = information-dense, 1 = filler)
- clickbaitSeverity 1-5 (5 = packaging lies about content, 1 = honest)
- claimOverreach 1-5 (5 = sensational claims beyond the evidence shown — "science provocateur" content; 1 = careful, supported claims)
- intellectualDemand 1-5 (5 = needs focus/prior knowledge, 1 = background watching)
- productionEffort 1-5
- novelty 1-5 (5 = rarely-covered angle, 1 = beaten topic)

Constrain ONLY what the person actually expressed — emit null for every axis and list their words don't touch. Each constraint gets the axis's desired value (target, 1-5) and an importance 1-10 reflecting how emphatically they expressed it. Anyone asking for "substance", "depth", or "no BS" wants high substanceDensity; complaints about hype, provocateurs, overclaiming, or "is this true?" content mean claimOverreach target 1 at high importance; complaints about clickbait mean clickbaitSeverity target 1.

topicsMore / topicsLess: SUBJECT tags only (lowercase) they want more/less of — things a video can be about, like "chess" or "rook endgames". At most ${TARGET_TOPICS_MAX} per list. EVERY distinct subject the person names must get a tag — a sentence listing several subjects names each of them: "science and civil engineering that is serious" names "science" AND "civil engineering"; "art, film, history" names three separate subjects, never a merged "film history". Only if a list would exceed the cap, save space by dropping extra qualifier variants of a subject that still keeps one tag — never by dropping a whole subject. No near-synonym variants ("engineering" already covers "engineering practice"). When they qualify a subject by skill tier or style, keep it as a two-word tag "<qualifier> <subject>" using exactly one of these qualifier words: ${DIGEST_TIER_QUALIFIERS.join(", ")} — and do NOT emit the bare parent tag: "chess videos featuring top tier play" → topicsMore "elite chess" — never bare "chess" and never free-form qualifiers like "top tier chess". When their wording spans two qualifiers, emit both: "low tier comic chess games" → topicsLess "comedic chess" AND "amateur chess". Videos are tagged with these exact qualifier words, so synonyms will not match. Quality adjectives are NOT tier qualifiers: "practical", "serious", "high quality" and similar say how a subject should be treated, not which tier of it — emit the bare subject and carry the adjective in the numeric axes: "engineering that is practical and serious" → topicsMore "engineering" plus high substanceDensity, never "practical engineering". Otherwise emit the bare subject whenever their interest genuinely spans all of it. Quality complaints are NOT topics: "clickbait", "hype", "overclaiming", "science provocateurs" and similar describe how a video is made, not what it is about — they belong in the numeric axes above (claimOverreach, clickbaitSeverity), never in topicsMore or topicsLess. The same applies when a complaint adjective is attached to a subject: "overhyped or sensational movies" objects to the hype, not to movies — raise those axes' importance and emit NO topicsLess tag for it; reserve topicsLess for subjects rejected outright.
formatsAvoid: at most 3 formats their words EXPLICITLY reject (e.g. "no reaction videos" → reaction), from: ${DIGEST_FORMATS.join(", ")}. Never include "other" — it is the catch-all for unclassifiable videos, not a real format. Wanting some subjects does not imply rejecting formats; when unsure, emit null.
tonesAvoid: at most 3 tones their words explicitly reject, from: ${DIGEST_TONES.join(", ")}.

You may also receive their recent personal votes on videos ("up" = good pick, "down" = not for me). Use them to sharpen importance and topic lists — generalize the pattern, never add a constraint their profile text and votes don't support.`;

const nullableField = {
  type: ["object", "null"],
  additionalProperties: false,
  required: ["target", "importance"],
  properties: {
    target: { type: "integer" },
    importance: { type: "integer" },
  },
} as const;

const nullableList = {
  type: ["object", "null"],
  additionalProperties: false,
  required: ["items", "importance"],
  properties: {
    items: { type: "array", items: { type: "string" } },
    importance: { type: "integer" },
  },
} as const;

export const TARGET_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["fields", "topicsMore", "topicsLess", "formatsAvoid", "tonesAvoid"],
  properties: {
    fields: {
      type: "object",
      additionalProperties: false,
      required: [
        "substanceDensity",
        "clickbaitSeverity",
        "claimOverreach",
        "intellectualDemand",
        "productionEffort",
        "novelty",
      ],
      properties: {
        substanceDensity: nullableField,
        clickbaitSeverity: nullableField,
        claimOverreach: nullableField,
        intellectualDemand: nullableField,
        productionEffort: nullableField,
        novelty: nullableField,
      },
    },
    topicsMore: nullableList,
    topicsLess: nullableList,
    formatsAvoid: nullableList,
    tonesAvoid: nullableList,
  },
} as const;

export function buildTranslateMessage(profile: Profile, feedback: FeedbackExample[] = []): string {
  const parts = [
    "<profile>",
    `More of: ${profile.moreOf.trim() || "(empty)"}`,
    `Less of: ${profile.lessOf.trim() || "(empty)"}`,
    "</profile>",
  ];
  if (feedback.length > 0) {
    parts.push("", "<votes>", JSON.stringify(feedback, null, 1), "</votes>");
  }
  return parts.join("\n");
}
