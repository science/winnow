// Pure "go deeper" discovery logic: the LLM-generated search-query pool and
// its LRU rotation. Persistence and orchestration live in the services/
// stores layers.

export interface QueryPoolEntry {
  text: string;
  /** Epoch ms of the last discovery run that used this query; 0 = never. */
  lastUsedAt: number;
}

/** Pool size the generator is clamped to — large enough that repeated
 * "go deeper" presses rotate through fresh searches before exhausting. */
export const QUERY_POOL_MAX = 12;

/** Queries consumed per discovery run (the "modest one-shot" scope). */
export const QUERIES_PER_RUN = 5;

/** Normalize raw LLM output into a pool: trim, drop empties, dedupe
 * case-insensitively (first occurrence wins), cap at QUERY_POOL_MAX. */
export function buildQueryPool(raw: string[], max = QUERY_POOL_MAX): QueryPoolEntry[] {
  const seen = new Set<string>();
  const pool: QueryPoolEntry[] = [];
  for (const item of raw) {
    const text = item.trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    pool.push({ text, lastUsedAt: 0 });
    if (pool.length >= max) break;
  }
  return pool;
}

/** The n least-recently-used queries (never-used first, then oldest stamp);
 * ties keep pool order so picks stay deterministic. */
export function pickQueries(pool: QueryPoolEntry[], n = QUERIES_PER_RUN): string[] {
  return pool
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.lastUsedAt - b.entry.lastUsedAt || a.index - b.index)
    .slice(0, n)
    .map(({ entry }) => entry.text);
}

/** Stamp lastUsedAt on exactly the queries a run consumed. */
export function markQueriesUsed(
  pool: QueryPoolEntry[],
  used: string[],
  now: number,
): QueryPoolEntry[] {
  const usedSet = new Set(used);
  return pool.map((q) => (usedSet.has(q.text) ? { ...q, lastUsedAt: now } : q));
}
