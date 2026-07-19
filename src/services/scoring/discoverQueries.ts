// "Go deeper" search-query generation: one cheap structured call turns the
// active profile (plus its translated target, when cached) into a pool of
// YouTube search queries. The pool persists per profile until the profile's
// yes/no text changes the input hash or the user explicitly regenerates —
// each discovery run rotates through it LRU-wise instead of re-asking.

import type { Profile, ProfileTarget, Provider } from "../../lib/types";
import { fnv1a } from "../../lib/profileHash";
import { buildQueryPool, QUERY_POOL_MAX, type QueryPoolEntry } from "../../lib/discovery";
import { profileKeys, storageGet, storageSet } from "../../lib/storage";
import { isDemoMode } from "../youtube/feedSource";
import { structuredCall } from "./structuredCall";
import type { StructuredCallFn } from "./twoPhase";

export const QUERY_PROMPT_VERSION = 1;

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

Produce ${QUERY_POOL_MAX} diverse search queries that would surface videos and creators squarely inside "More of this" — including adjacent niches the person would plausibly love but may not know to search for. Vary the angle across queries (topic terms, format terms like "deep dive" or "full process", creator-discovery phrasing); avoid near-duplicates. Never generate queries that chase anything in "Less of this". Queries should read like what an expert fan would actually type into YouTube search — short, concrete, no hashtags, no quotes.`;

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
 * say. Votes are deliberately NOT included — the pool stays stable until the
 * profile text itself changes (or the user regenerates). */
export function queryPoolInputHashFor(profile: Profile, model: string): string {
  return fnv1a(
    [profile.moreOf, profile.lessOf, String(QUERY_PROMPT_VERSION), model].join("|"),
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
  const inputHash = queryPoolInputHashFor(opts.profile, model);

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
