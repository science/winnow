// "Go deeper" search-query generation: one cheap structured call turns the
// active profile (plus its translated target, when cached) into a pool of
// YouTube search queries. The pool persists per profile until the profile's
// yes/no text changes the input hash or the user explicitly regenerates —
// each discovery run rotates through it LRU-wise instead of re-asking.

import type { Profile, ProfileTarget, Provider } from "../../lib/types";
import { fnv1a } from "../../lib/profileHash";
import { targetHash } from "../../lib/rubricScorer";
import { buildQueryPool, QUERY_POOL_MAX, type QueryPoolEntry } from "../../lib/discovery";
import { profileKeys, storageGet, storageSet } from "../../lib/storage";
import { isDemoMode } from "../youtube/feedSource";
import { structuredCall } from "./structuredCall";
import type { StructuredCallFn } from "./twoPhase";

/** Bump on any prompt or schema change — it keys the pool cache, so without a
 * bump every existing user keeps the pool the old prompt produced and the fix
 * ships dead. (v2, 2026-07-31: subject-coverage rules.) */
export const QUERY_PROMPT_VERSION = 2;

export interface StoredQueryPool {
  inputHash: string;
  queries: QueryPoolEntry[];
}

export const QUERIES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["queries"],
  properties: {
    queries: { type: "array", items: { type: "string" } },
  },
} as const;

export const QUERIES_SYSTEM_PROMPT = `You generate YouTube search queries for one person, from their interest profile: a "More of this" list of what they want and a "Less of this" list of what they don't. Sometimes you also get the structured constraints a ranking system derived from that profile.

First, identify every distinct SUBJECT the person named in "More of this" — chess, history, civil engineering, cooking, and so on. Tier-qualified variants of one subject are ONE subject, not several: "elite chess", "casual chess" and "amateur chess" all count as the single subject "chess". The derived constraints often repeat one subject across several qualified tags; that repetition reflects how the constraints are written, NOT how much the person cares about it. Never read it as emphasis.

Then produce ${QUERY_POOL_MAX} search queries under these rules, in order of priority:

1. COVERAGE FIRST. Every distinct subject gets at least one query before any subject gets a second. If there are more subjects than slots, cover as many distinct subjects as you can — never spend two slots on one subject while another subject has none.
2. INTERLEAVE, never group. Order the output so consecutive queries are for different subjects (subject A, subject B, subject C, then back to A). Do not emit all of one subject's queries together: only the first few queries get used on any given run, so a grouped list means whole subjects are never searched at all.
3. Only after every subject is covered, spend remaining slots on second queries for the richest subjects, and on adjacent niches the person would plausibly love but may not know to search for.
4. Vary the angle across queries (topic terms, format terms like "deep dive" or "full process", creator-discovery phrasing). Avoid near-duplicates. Varying the angle is NOT a substitute for covering different subjects.
5. Never generate queries that chase anything in "Less of this", and never build a query out of an avoided tag.

Queries should read like what an expert fan would actually type into YouTube search — short, concrete, no hashtags, no quotes.`;

export function buildQueriesMessage(profile: Profile, target: ProfileTarget | null): string {
  const lines = [
    "<interest-profile>",
    `More of this: ${profile.moreOf.trim() || "(not specified)"}`,
    `Less of this: ${profile.lessOf.trim() || "(not specified)"}`,
    "</interest-profile>",
  ];
  if (target) {
    lines.push(
      "",
      "<derived-ranking-constraints>",
      JSON.stringify(target, null, 1),
      "</derived-ranking-constraints>",
    );
  }
  lines.push("", `Generate the ${QUERY_POOL_MAX} search queries.`);
  return lines.join("\n");
}

/** Cache key for the pool: everything that changes what the generator would
 * say — including the translated target, which is pasted into the prompt.
 * Omitting it (pre-2026-07-31) let a pool derived under a different (or
 * absent) translation survive as a cache hit forever. Votes are deliberately
 * NOT included: the pool stays stable until the profile itself changes (or
 * the user regenerates). */
export function queryPoolInputHashFor(
  profile: Profile,
  model: string,
  target?: ProfileTarget | null,
): string {
  return fnv1a(
    [
      profile.moreOf,
      profile.lessOf,
      String(QUERY_PROMPT_VERSION),
      model,
      target ? targetHash(target) : "",
    ].join("|"),
  );
}

/** Deterministic offline pool so demo mode (and nonlive e2e) can drive the
 * whole go-deeper flow without an AI call: one query per profile phrase. */
export function demoQueryTexts(profile: Profile): string[] {
  const phrases = profile.moreOf
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const base = phrases.length > 0 ? phrases : ["interesting videos"];
  return base.slice(0, QUERY_POOL_MAX).map((p) => `${p} deep dive`);
}

export interface EnsureQueryPoolOpts {
  profileId: string;
  profile: Profile;
  provider: Provider;
  apiKey: string;
  /** Generator model; callers pass the provider's cheap enrichment tier. */
  model: string;
  /** Cached translated target, when the two-phase engine has one. */
  target?: ProfileTarget | null;
  /** Regenerate even when the cached pool's hash is current. */
  force?: boolean;
  demo?: boolean;
  callFn?: StructuredCallFn;
}

/** Return the profile's query pool, generating (and persisting) a fresh one
 * when none is cached, the profile text changed, or force is set. */
export async function ensureQueryPool(opts: EnsureQueryPoolOpts): Promise<StoredQueryPool> {
  const demo = opts.demo ?? isDemoMode();
  const callFn = opts.callFn ?? structuredCall;
  const model = demo ? "demo-stub" : opts.model;
  const key = profileKeys(opts.profileId).discoverQueries;
  const inputHash = queryPoolInputHashFor(opts.profile, model, opts.target);

  if (!opts.force) {
    const stored = await storageGet<StoredQueryPool>(key);
    if (stored?.inputHash === inputHash && stored.queries.length > 0) return stored;
  }

  const texts = demo
    ? demoQueryTexts(opts.profile)
    : (
        await callFn<{ queries: string[] }>({
          provider: opts.provider,
          apiKey: opts.apiKey,
          model,
          system: QUERIES_SYSTEM_PROMPT,
          user: buildQueriesMessage(opts.profile, opts.target ?? null),
          schema: QUERIES_SCHEMA,
          name: "generate_search_queries",
        })
      ).queries;

  const pool: StoredQueryPool = { inputHash, queries: buildQueryPool(texts) };
  await storageSet(key, pool);
  return pool;
}
