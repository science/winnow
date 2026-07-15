// Phase-2b: the pure ranker. Given a video's cached digest and the profile's
// translated target, produce a score/reason/clickbait synchronously — no LLM,
// no network. Ports movie-night's RubricSoftScorer semantics: weighted
// average over constrained fields only, ordinal near-miss credit
// (1 - distance/4), empty target ⇒ everything ties at 50. Reasons are
// composed deterministically from the top-contributing constraints, so they
// can't hallucinate.

import { fnv1a } from "./profileHash";
import {
  DIGEST_NUMERIC_FIELDS,
  type DigestNumericField,
  type ListTarget,
  type ProfileTarget,
  type VideoDigest,
} from "./types";

/** Participates in the two-phase score-cache hash — bump when ranking or
 * reason-composition semantics change. */
export const RANKER_VERSION = 3;

/** Digest axes ≥ this value set the clickbait flag regardless of profile. */
const CLICKBAIT_FLAG_THRESHOLD = 4;

/** Ceiling for any video hitting an avoided topic — just under the
 * Worth-a-look threshold (50, src/lib/tiers.ts), so an explicit "less of"
 * always lands behind the fold no matter how well the quality axes score.
 * Only topics cap: formats/tones are too common to be a veto (a "humorous"
 * cap would collapse whole feeds, cf. the 2026-07 feed-collapse bug). */
const AVOID_TOPIC_SCORE_CAP = 45;

// Binary constraints carry asymmetric evidence. Missing the more-of list is
// weak negative signal (a broad feed matches any list rarely — v1's credit 0
// here sank entire feeds below the winnowed threshold). Avoid-lists only
// subtract: not hitting one says nothing, so it contributes no weight at all
// (v1's credit 1 floated junk into the feed; a 0.5 draft diluted matches).
const TOPICS_MORE_MISS_CREDIT = 0.35;

const EMPTY_LIST: ListTarget = { items: [], importance: 0 };

export const EMPTY_TARGET: ProfileTarget = {
  fields: {},
  topicsMore: EMPTY_LIST,
  topicsLess: EMPTY_LIST,
  formatsAvoid: EMPTY_LIST,
  tonesAvoid: EMPTY_LIST,
};

export interface RankedScore {
  score: number;
  reason: string;
  clickbait: boolean;
}

export function isEmptyTarget(t: ProfileTarget): boolean {
  const fieldCount = DIGEST_NUMERIC_FIELDS.filter((f) => t.fields[f]).length;
  const lists = [t.topicsMore, t.topicsLess, t.formatsAvoid, t.tonesAvoid];
  return fieldCount === 0 && lists.every((l) => l.items.length === 0 || l.importance === 0);
}

const FIELD_PHRASES: Record<DigestNumericField, { good: string; bad: string }> = {
  substanceDensity: { good: "dense with substance", bad: "thin on substance" },
  clickbaitSeverity: { good: "clean packaging", bad: "bait-style packaging" },
  claimOverreach: { good: "claims stay grounded", bad: "overclaims beyond its evidence" },
  intellectualDemand: { good: "right depth for you", bad: "not the depth you want" },
  productionEffort: { good: "well produced", bad: "low production effort" },
  novelty: { good: "fresh angle", bad: "well-trodden ground" },
};

const norm = (s: string): string => s.trim().toLowerCase();

/** "chess engines" → {chess, engine}: split on non-alphanumerics, lightly
 * singularized so plural/singular variants agree. */
function tokens(s: string): Set<string> {
  const out = new Set<string>();
  for (const raw of s.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw) continue;
    out.add(raw.length > 3 && raw.endsWith("s") && !raw.endsWith("ss") ? raw.slice(0, -1) : raw);
  }
  return out;
}

function isSubset(a: Set<string>, b: Set<string>): boolean {
  for (const t of a) if (!b.has(t)) return false;
  return true;
}

/** A profile item matches a digest topic iff every item token appears in
 * that single topic — broad "chess" covers "chess openings", but never the
 * reverse: a digest topic missing the qualifier ("chess" vs avoid item
 * "comic chess") proves nothing about the video. Bidirectional substring
 * here is what made every chess video hit both the seek and avoid lists
 * (the 2026-07 gotham mis-ranking). No token union across digest topics:
 * "computer science" must not match ["computer engine", "science"].
 * Returns the matched PROFILE item so reasons name the user's own words. */
function topicMatch(digestTopics: string[], items: string[]): string | null {
  const topicTokenSets = digestTopics.map(tokens);
  for (const item of items) {
    const itemTokens = tokens(item);
    if (itemTokens.size === 0) continue;
    if (topicTokenSets.some((tt) => isSubset(itemTokens, tt))) return norm(item);
  }
  return null;
}

interface Contribution {
  weight: number;
  credit: number; // 0..1
  /** Reason phrase for credit ≥ 0.5 / below; null = never mention. */
  good: string | null;
  bad: string | null;
}

function contributions(
  digest: VideoDigest,
  target: ProfileTarget,
): { parts: Contribution[]; avoidedTopic: string | null } {
  const out: Contribution[] = [];
  let avoidedTopic: string | null = null;
  for (const field of DIGEST_NUMERIC_FIELDS) {
    const ft = target.fields[field];
    if (!ft || ft.importance <= 0) continue;
    out.push({
      weight: ft.importance,
      credit: 1 - Math.abs(digest[field] - ft.target) / 4,
      ...FIELD_PHRASES[field],
    });
  }
  if (target.topicsMore.items.length > 0 && target.topicsMore.importance > 0) {
    const matched = topicMatch(digest.topics, target.topicsMore.items);
    out.push({
      weight: target.topicsMore.importance,
      credit: matched ? 1 : TOPICS_MORE_MISS_CREDIT,
      good: matched ? `on-profile: ${matched}` : null,
      bad: "off your stated interests",
    });
  }
  if (target.topicsLess.items.length > 0 && target.topicsLess.importance > 0) {
    const matched = topicMatch(digest.topics, target.topicsLess.items);
    if (matched) {
      avoidedTopic = matched;
      out.push({
        weight: target.topicsLess.importance,
        credit: 0,
        good: null,
        bad: `avoided: ${matched}`,
      });
    }
  }
  if (target.formatsAvoid.items.length > 0 && target.formatsAvoid.importance > 0) {
    if (target.formatsAvoid.items.map(norm).includes(norm(digest.format))) {
      out.push({
        weight: target.formatsAvoid.importance,
        credit: 0,
        good: null,
        bad: `format you avoid: ${digest.format}`,
      });
    }
  }
  if (target.tonesAvoid.items.length > 0 && target.tonesAvoid.importance > 0) {
    if (target.tonesAvoid.items.map(norm).includes(norm(digest.emotionalTone))) {
      out.push({
        weight: target.tonesAvoid.importance,
        credit: 0,
        good: null,
        bad: `tone you avoid: ${digest.emotionalTone}`,
      });
    }
  }
  return { parts: out, avoidedTopic };
}

function composeReason(parts: Contribution[], lead: string | null): string {
  const phrased = parts
    .map((c) => ({ signed: c.weight * (c.credit - 0.5), phrase: c.credit >= 0.5 ? c.good : c.bad }))
    .filter((c): c is { signed: number; phrase: string } => c.phrase !== null)
    .sort((a, b) => Math.abs(b.signed) - Math.abs(a.signed))
    .map((c) => c.phrase);
  // A capping avoid-hit leads regardless of weight — it decided the tier.
  const ordered = lead === null ? phrased : [lead, ...phrased.filter((p) => p !== lead)];
  const top = ordered.slice(0, 3);
  if (top.length === 0) return "No strong signals either way for your profile";
  return top.join("; ").slice(0, 120);
}

/** Rank one digest against the target. Pure and instant — safe to run over
 * the whole feed on every profile edit. */
export function rankVideo(digest: VideoDigest, target: ProfileTarget): RankedScore {
  const clickbait =
    digest.clickbaitSeverity >= CLICKBAIT_FLAG_THRESHOLD ||
    digest.claimOverreach >= CLICKBAIT_FLAG_THRESHOLD;
  const { parts, avoidedTopic } = contributions(digest, target);
  const totalWeight = parts.reduce((sum, c) => sum + c.weight, 0);
  if (totalWeight === 0) {
    return { score: 50, reason: "No profile constraints to rank against yet", clickbait };
  }
  let score = Math.round(
    (100 * parts.reduce((sum, c) => sum + c.weight * c.credit, 0)) / totalWeight,
  );
  if (avoidedTopic !== null) score = Math.min(score, AVOID_TOPIC_SCORE_CAP);
  return {
    score: Math.max(0, Math.min(100, score)),
    reason: composeReason(parts, avoidedTopic === null ? null : `avoided: ${avoidedTopic}`),
    clickbait,
  };
}

// --- target canonicalization (strict-schema null workaround) --------------

function cleanItems(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((t): t is string => typeof t === "string")
    .map(norm)
    .filter(Boolean)
    .slice(0, 12);
}

/** Translator synonym spam ("engineering" ×5 variants) adds no matching
 * power under token-subset matching: if Y's tokens ⊆ X's tokens, X can only
 * match topics Y already matches — so drop X. Equal token sets keep the
 * first occurrence. */
function dedupeSupersets(items: string[]): string[] {
  const sets = items.map(tokens);
  return items.filter((_, i) => {
    for (let j = 0; j < items.length; j++) {
      if (j === i || !isSubset(sets[j]!, sets[i]!)) continue;
      if (!isSubset(sets[i]!, sets[j]!)) return false; // j strictly more general
      if (j < i) return false; // same token set — keep the first
    }
    return true;
  });
}

function cleanList(
  value: unknown,
  opts: { dropItems?: readonly string[]; maxItems?: number } = {},
): ListTarget {
  if (value === null || typeof value !== "object") return EMPTY_LIST;
  const obj = value as { items?: unknown; importance?: unknown };
  const items = dedupeSupersets(cleanItems(obj.items))
    .filter((i) => !(opts.dropItems ?? []).includes(i))
    .slice(0, opts.maxItems ?? 12);
  const importance =
    typeof obj.importance === "number" && items.length > 0
      ? Math.max(0, Math.min(10, Math.round(obj.importance)))
      : 0;
  return items.length > 0 ? { items, importance } : EMPTY_LIST;
}

/** A person rejects a couple of formats/tones; a translator emitting half
 * the vocabulary is hallucinating taste (observed live with nano). Model
 * item order roughly tracks salience, so keeping the head is safe. */
const AVOID_LIST_MAX = 3;

/** Strict structured outputs can't mark fields optional, so the translator
 * emits null for unconstrained fields (movie-night workaround); this strips
 * the nulls and clamps everything. Garbage in ⇒ empty target out. */
export function canonicalizeTarget(raw: unknown): ProfileTarget {
  const obj = (raw ?? {}) as { fields?: unknown } & Record<string, unknown>;
  const rawFields = (obj.fields ?? {}) as Record<string, unknown>;
  const fields: ProfileTarget["fields"] = {};
  for (const field of DIGEST_NUMERIC_FIELDS) {
    const v = rawFields[field];
    if (v === null || typeof v !== "object") continue;
    const ft = v as { target?: unknown; importance?: unknown };
    if (typeof ft.target !== "number" || typeof ft.importance !== "number") continue;
    const importance = Math.max(0, Math.min(10, Math.round(ft.importance)));
    if (importance === 0) continue;
    fields[field] = { target: Math.max(1, Math.min(5, Math.round(ft.target))), importance };
  }
  return {
    fields,
    topicsMore: cleanList(obj["topicsMore"]),
    topicsLess: cleanList(obj["topicsLess"]),
    // "other" is clampDigest's catch-all for unrecognized formats — avoiding
    // it would penalize arbitrary innocent videos, so it can't be a target.
    formatsAvoid: cleanList(obj["formatsAvoid"], { dropItems: ["other"], maxItems: AVOID_LIST_MAX }),
    tonesAvoid: cleanList(obj["tonesAvoid"], { maxItems: AVOID_LIST_MAX }),
  };
}

/** Deterministic hash over the canonical target — the two-phase analogue of
 * profileHash, part of the ranked-score cache key. */
export function targetHash(t: ProfileTarget): string {
  const canonical = JSON.stringify({
    fields: DIGEST_NUMERIC_FIELDS.map((f) =>
      t.fields[f] ? [f, t.fields[f]!.target, t.fields[f]!.importance] : null,
    ),
    lists: [t.topicsMore, t.topicsLess, t.formatsAvoid, t.tonesAvoid].map((l) => [
      [...l.items].sort(),
      l.importance,
    ]),
  });
  return fnv1a(canonical);
}
