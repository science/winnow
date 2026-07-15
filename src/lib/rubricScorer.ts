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
export const RANKER_VERSION = 1;

/** Digest axes ≥ this value set the clickbait flag regardless of profile. */
const CLICKBAIT_FLAG_THRESHOLD = 4;

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

/** Fuzzy topic equality: case-insensitive substring in either direction, so
 * profile "chess openings" matches digest topic "chess" and vice versa. */
function topicMatch(digestTopics: string[], items: string[]): string | null {
  for (const topic of digestTopics.map(norm)) {
    for (const item of items.map(norm)) {
      if (topic.includes(item) || item.includes(topic)) return topic;
    }
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

function contributions(digest: VideoDigest, target: ProfileTarget): Contribution[] {
  const out: Contribution[] = [];
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
      credit: matched ? 1 : 0,
      good: matched ? `on-profile: ${matched}` : null,
      bad: "off your stated interests",
    });
  }
  if (target.topicsLess.items.length > 0 && target.topicsLess.importance > 0) {
    const matched = topicMatch(digest.topics, target.topicsLess.items);
    out.push({
      weight: target.topicsLess.importance,
      credit: matched ? 0 : 1,
      good: null,
      bad: matched ? `avoided topic: ${matched}` : null,
    });
  }
  if (target.formatsAvoid.items.length > 0 && target.formatsAvoid.importance > 0) {
    const hit = target.formatsAvoid.items.map(norm).includes(norm(digest.format));
    out.push({
      weight: target.formatsAvoid.importance,
      credit: hit ? 0 : 1,
      good: null,
      bad: hit ? `format you avoid: ${digest.format}` : null,
    });
  }
  if (target.tonesAvoid.items.length > 0 && target.tonesAvoid.importance > 0) {
    const hit = target.tonesAvoid.items.map(norm).includes(norm(digest.emotionalTone));
    out.push({
      weight: target.tonesAvoid.importance,
      credit: hit ? 0 : 1,
      good: null,
      bad: hit ? `tone you avoid: ${digest.emotionalTone}` : null,
    });
  }
  return out;
}

function composeReason(parts: Contribution[]): string {
  const phrased = parts
    .map((c) => ({ signed: c.weight * (c.credit - 0.5), phrase: c.credit >= 0.5 ? c.good : c.bad }))
    .filter((c): c is { signed: number; phrase: string } => c.phrase !== null)
    .sort((a, b) => Math.abs(b.signed) - Math.abs(a.signed))
    .slice(0, 3)
    .map((c) => c.phrase);
  if (phrased.length === 0) return "No strong signals either way for your profile";
  return phrased.join("; ").slice(0, 120);
}

/** Rank one digest against the target. Pure and instant — safe to run over
 * the whole feed on every profile edit. */
export function rankVideo(digest: VideoDigest, target: ProfileTarget): RankedScore {
  const clickbait =
    digest.clickbaitSeverity >= CLICKBAIT_FLAG_THRESHOLD ||
    digest.claimOverreach >= CLICKBAIT_FLAG_THRESHOLD;
  const parts = contributions(digest, target);
  const totalWeight = parts.reduce((sum, c) => sum + c.weight, 0);
  if (totalWeight === 0) {
    return { score: 50, reason: "No profile constraints to rank against yet", clickbait };
  }
  const score = Math.round(
    (100 * parts.reduce((sum, c) => sum + c.weight * c.credit, 0)) / totalWeight,
  );
  return { score: Math.max(0, Math.min(100, score)), reason: composeReason(parts), clickbait };
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

function cleanList(value: unknown): ListTarget {
  if (value === null || typeof value !== "object") return EMPTY_LIST;
  const obj = value as { items?: unknown; importance?: unknown };
  const items = cleanItems(obj.items);
  const importance =
    typeof obj.importance === "number" && items.length > 0
      ? Math.max(0, Math.min(10, Math.round(obj.importance)))
      : 0;
  return items.length > 0 ? { items, importance } : EMPTY_LIST;
}

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
    formatsAvoid: cleanList(obj["formatsAvoid"]),
    tonesAvoid: cleanList(obj["tonesAvoid"]),
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
