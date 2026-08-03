// Phase-2b: the pure ranker. Given a video's cached digest and the profile's
// translated target, produce a score/reason/clickbait synchronously — no LLM,
// no network. Ports movie-night's RubricSoftScorer semantics: weighted
// average over constrained fields only, ordinal near-miss credit
// (1 - distance/4), empty target ⇒ everything ties at 50. Reasons are
// composed deterministically from the top-contributing constraints, so they
// can't hallucinate.

import { fnv1a } from "./profileHash";
import { DIGEST_TIER_QUALIFIERS } from "./digest";
import {
  DIGEST_NUMERIC_FIELDS,
  type DigestNumericField,
  type ListTarget,
  type ProfileTarget,
  type VideoDigest,
} from "./types";

/** Participates in the two-phase score-cache hash — bump when ranking or
 * reason-composition semantics change. */
export const RANKER_VERSION = 5;

/** Digest axes ≥ this value set the clickbait flag regardless of profile. */
const CLICKBAIT_FLAG_THRESHOLD = 4;

/** Ceiling for any video hitting an avoided topic — just under the
 * Worth-a-look threshold (50, src/lib/tiers.ts), so an explicit "less of"
 * always lands behind the fold no matter how well the quality axes score.
 * Only topics cap: formats/tones are too common to be a veto (a "humorous"
 * cap would collapse whole feeds, cf. the 2026-07 feed-collapse bug). */
export const AVOID_TOPIC_SCORE_CAP = 45;

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

/** Topic weight floor, as a fraction of the total numeric-axis weight.
 *
 * Derived, not tuned. An off-profile video earns TOPICS_MORE_MISS_CREDIT on
 * the topic contribution and can earn full credit everywhere else, so its
 * ceiling is (W + 0.35F)/(W + F) for field weight W and topic weight F.
 * Requiring that to stay under TIER_THRESHOLDS.top (75) gives F > 0.625W;
 * 0.7 clears it with margin. The ratio form is what matters: the ceiling
 * works out to ~73 for ANY W, so the guarantee survives the translator
 * emitting a different importance mix on the next run — which it does
 * (docs/CUT_SCORE_RANKING.md §5).
 *
 * The invariant: production quality alone can carry a video to the top of
 * Worth-a-look, never into Top picks. Only relevance does that. */
export const TOPIC_WEIGHT_FLOOR_RATIO = 0.7;

export interface RankedScore {
  score: number;
  reason: string;
  clickbait: boolean;
  /** True when a hard cap clamped the score to AVOID_TOPIC_SCORE_CAP — an
   * avoided topic or a quality veto. Reported so later adjustments
   * (applyChannelBoost) honor the cap instead of quietly lifting the video
   * back over the fold. */
  capped: boolean;
}

/** How much a subscribed channel lifts its videos. Deliberately modest: the
 * user chose the creator, not this particular video, so it reorders within a
 * tier and can nudge across one — it is not a free pass. */
export const SUBSCRIBED_CHANNEL_BOOST = 8;

/**
 * Lift a video because the user subscribes to its channel. Pure, and applied
 * outside rankVideo so the ranker stays a function of (digest, target) only.
 *
 * An avoided-topic cap always wins: subscribing to a creator must never drag
 * their off-profile videos in front of the fold, or "avoid X" stops meaning
 * anything the moment you follow someone who sometimes does X.
 */
export function applyChannelBoost(ranked: RankedScore, subscribed: boolean): RankedScore {
  if (!subscribed) return ranked;
  const raw = Math.min(100, ranked.score + SUBSCRIBED_CHANNEL_BOOST);
  const score = ranked.capped ? Math.min(raw, AVOID_TOPIC_SCORE_CAP) : raw;
  if (score === ranked.score) return ranked;
  return { ...ranked, score, reason: `${ranked.reason}; followed creator`.slice(0, 120) };
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

/** Every profile item the digest matches, in list order. A profile item
 * matches a digest topic iff every item token appears in that single topic —
 * broad "chess" covers "chess openings", but never the reverse: a digest
 * topic missing the qualifier ("chess" vs avoid item "comic chess") proves
 * nothing about the video. Bidirectional substring here is what made every
 * chess video hit both the seek and avoid lists (the 2026-07 gotham
 * mis-ranking). No token union across digest topics: "computer science" must
 * not match ["computer engine", "science"]. Returns the matched PROFILE
 * items so reasons (and subject breakdowns) name the user's own words.
 *
 * Exported for subject attribution in diagnostics: scoring and any report
 * about scoring must share one matcher, or the report can credit a subject
 * the ranker didn't. */
export function matchedTopics(digestTopics: string[], items: string[]): string[] {
  const topicTokenSets = digestTopics.map(tokens);
  const out: string[] = [];
  for (const item of items) {
    const itemTokens = tokens(item);
    if (itemTokens.size === 0) continue;
    if (topicTokenSets.some((tt) => isSubset(itemTokens, tt))) out.push(norm(item));
  }
  return out;
}

/** First match only — ranking asks a binary question, so it stops early. */
function topicMatch(digestTopics: string[], items: string[]): string | null {
  return matchedTopics(digestTopics, items)[0] ?? null;
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
    // Floor the topic weight against the numeric axes accumulated above. Only
    // when the profile actually names topics — with an empty seek list the
    // floor would amplify a constraint that does not exist.
    const fieldWeight = out.reduce((sum, c) => sum + c.weight, 0);
    out.push({
      weight: Math.max(
        target.topicsMore.importance,
        Math.round(TOPIC_WEIGHT_FLOOR_RATIO * fieldWeight),
      ),
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
    return {
      score: 50,
      reason: "No profile constraints to rank against yet",
      clickbait,
      capped: false,
    };
  }
  let score = Math.round(
    (100 * parts.reduce((sum, c) => sum + c.weight * c.credit, 0)) / totalWeight,
  );
  // Cut scores: bait is disqualifying, not discountable. Reuses the clickbait
  // flag (severity or overreach >= 4) rather than inventing a second
  // threshold — on the real capture that rule caught the bait and the
  // science-provocateur videos while sparing merely-off-topic content.
  // substanceDensity is deliberately NOT veto-eligible: it is
  // genre-correlated, not garbage-correlated (live music legitimately scores
  // 1), and vetoing it winnowed 46% of the capture.
  let lead: string | null = avoidedTopic === null ? null : `avoided: ${avoidedTopic}`;
  if (clickbait) {
    lead ??=
      digest.clickbaitSeverity >= CLICKBAIT_FLAG_THRESHOLD
        ? FIELD_PHRASES.clickbaitSeverity.bad
        : FIELD_PHRASES.claimOverreach.bad;
  }
  const capped = avoidedTopic !== null || clickbait;
  if (capped) score = Math.min(score, AVOID_TOPIC_SCORE_CAP);
  return {
    score: Math.max(0, Math.min(100, score)),
    reason: composeReason(parts, lead),
    clickbait,
    capped,
  };
}

// --- target canonicalization (strict-schema null workaround) --------------

/** Per-list cap for translated topic tags. The digest side caps at 8 topics
 * per video (TOPICS_MAX); a profile legitimately spans more subjects — the
 * 2026-07-19 bug was the prompt's tighter cap silently dropping whole
 * subjects (art, history, science). translatePrompt quotes this number. */
export const TARGET_TOPICS_MAX = 12;

/** The enricher's subjectTiers are schema-forced onto DIGEST_TIER_QUALIFIERS,
 * so a translator tag with any other leading qualifier token-matches nothing.
 * Known free-form tier phrases are rewritten onto the canonical word; sorted
 * longest-first so "top tier chess" → "elite chess", not "elite tier chess".
 * Ambiguous words stay out: "comic" is a subject in "comic books" — it gets
 * EXPANDED (original kept, "comedic" variant added) below instead. */
export const TIER_QUALIFIER_SYNONYMS: ReadonlyArray<[string, string]> = (
  [
    ["world class", "elite"],
    ["top tier", "elite"],
    ["high level", "elite"],
    ["expert", "elite"],
    ["top", "elite"],
    ["low tier", "amateur"],
    ["hobbyist", "amateur"],
    ["pro", "professional"],
    ["novice", "beginner"],
    ["funny", "comedic"],
    ["recreational", "casual"],
  ] as Array<[string, string]>
)
  .filter(([, canon]) => (DIGEST_TIER_QUALIFIERS as readonly string[]).includes(canon))
  .sort((a, b) => b[0].length - a[0].length);

/** Qualifiers denoting the same skill register. The translator and the
 * enricher are independent LLM calls; the shared vocabulary makes them spell
 * a qualifier the same way but does nothing to make them CHOOSE the same one.
 * Live 2026-08-01: "top tier play" translated to "elite chess" while the
 * enricher tagged 11 of that user's chess videos "professional chess" — same
 * register, different word, no token overlap, zero matches on their headline
 * interest.
 *
 * Seek tags expand across the band so either choice matches. Avoid tags never
 * do: broadening a veto hides content the user asked for (the 2026-07 gotham
 * mis-ranking), and the translator prompt already enumerates every variant a
 * rejected register covers. "casual"/"comedic" are style, not skill, and have
 * no peers — a celebrity exhibition is casual between elite players. */
const SKILL_BAND_PEERS: Readonly<Record<string, string>> = {
  elite: "professional",
  professional: "elite",
  amateur: "beginner",
  beginner: "amateur",
};

/** ["elite chess"] → ["elite chess", "professional chess"]. Seek tags only. */
function expandSkillBand(tag: string): string[] {
  const sep = tag.indexOf(" ");
  if (sep <= 0) return [tag];
  const peer = SKILL_BAND_PEERS[tag.slice(0, sep)];
  return peer ? [tag, `${peer} ${tag.slice(sep + 1)}`] : [tag];
}

/** Quality adjectives say how a subject should be treated — the numeric axes
 * carry that. Stripped from SEEK tags only, so the bare subject can match
 * ("practical engineering" is a tag the enricher never emits); an avoid tag
 * broadened the same way would veto wanted content (the gotham shape), so
 * avoid tags keep their adjective and fail inert instead. Longest-first. */
const QUALITY_ADJECTIVE_PREFIXES: readonly string[] = [
  "good quality",
  "high quality",
  "high effort",
  "well produced",
  "well made",
  "real world",
  "practical",
  "serious",
  "quality",
  "good",
].sort((a, b) => b.length - a.length);

function rewriteQualifierPrefix(tag: string, mode: "seek" | "avoid"): string {
  let t = tag;
  for (let guard = 0; guard < 8; guard++) {
    const tier = TIER_QUALIFIER_SYNONYMS.find(([syn]) => t.startsWith(`${syn} `));
    if (tier) {
      t = `${tier[1]} ${t.slice(tier[0].length + 1)}`;
      continue;
    }
    if (mode === "seek") {
      const adj = QUALITY_ADJECTIVE_PREFIXES.find(
        (a) => t.startsWith(`${a} `) && t.length > a.length + 1,
      );
      if (adj) {
        t = t.slice(adj.length + 1);
        continue;
      }
    }
    break;
  }
  return t;
}

/** Quality complaints the prompt bans from topic lists but cheap translators
 * still emit ("science provocateurs", live 2026-07-19). As topics they match
 * nothing the enricher tags and clutter the audit display; the axes
 * (claimOverreach/clickbaitSeverity) already carry the intent. */
const COMPLAINT_TOKENS = new Set([
  "clickbait",
  "clickbaity",
  "hype",
  "hyped",
  "overhyped",
  "overclaim",
  "overclaiming",
  "overclaimed",
  "provocateur",
  "sensational",
  "sensationalist",
  "sensationalism",
  "sensationalized",
]);

function isComplaintTag(tag: string): boolean {
  for (const t of tokens(tag)) if (COMPLAINT_TOKENS.has(t)) return true;
  return false;
}

function cleanItems(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((t): t is string => typeof t === "string")
    .map(norm)
    .filter(Boolean)
    .slice(0, TARGET_TOPICS_MAX * 2); // headroom: dedupe/complaint-drop below may shrink the list
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
  opts: { dropItems?: readonly string[]; maxItems?: number; topics?: "seek" | "avoid" } = {},
): ListTarget {
  if (value === null || typeof value !== "object") return EMPTY_LIST;
  const obj = value as { items?: unknown; importance?: unknown };
  let raw = cleanItems(obj.items);
  if (opts.topics) {
    raw = raw
      .map((i) => rewriteQualifierPrefix(i, opts.topics!))
      .filter((i) => !isComplaintTag(i))
      // "comic X": tier qualifier ("comic chess", live nano emits the user's
      // literal word) or subject ("comic books")? Expand instead of rewrite —
      // whichever reading is right matches, the other tag stays inert.
      .flatMap((i) => (i.startsWith("comic ") ? [i, `comedic ${i.slice(6)}`] : [i]));
    // Band peers last, so expansions of the "comic"→"comedic" variants are
    // considered too. Seek only — see SKILL_BAND_PEERS.
    if (opts.topics === "seek") raw = raw.flatMap(expandSkillBand);
  }
  const items = dedupeSupersets(raw)
    .filter((i) => !(opts.dropItems ?? []).includes(i))
    .slice(0, opts.maxItems ?? TARGET_TOPICS_MAX);
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
    topicsMore: cleanList(obj["topicsMore"], { topics: "seek" }),
    topicsLess: cleanList(obj["topicsLess"], { topics: "avoid" }),
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
