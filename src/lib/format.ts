// Loose parsers for YouTube's display text. YouTube serves formatted
// strings, not structured data — every parser here returns null rather
// than guessing when the shape is unrecognized.

/** "12:34" → 754, "1:02:03" → 3723. Null for anything else. */
export function parseDurationText(text: string): number | null {
  const m = /^(\d+):([0-5]?\d)(?::([0-5]?\d))?$/.exec(text.trim());
  if (!m) return null;
  const [, a, b, c] = m;
  if (c !== undefined) {
    return Number(a) * 3600 + Number(b) * 60 + Number(c);
  }
  return Number(a) * 60 + Number(b);
}

/** 754 → "12:34", 3723 → "1:02:03". */
export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

const COMPACT_MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  m: 1_000_000,
  b: 1_000_000_000,
};

/** "123,456 views" → 123456; "2.1M" → 2100000; "No views" → 0; else null. */
export function parseViewCountText(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (t === "") return null;
  if (t.startsWith("no ")) return 0;
  const m = /^([\d,]+(?:\.\d+)?)\s*([kmb])?/.exec(t);
  if (!m || m[1] === undefined) return null;
  const base = Number(m[1].replace(/,/g, ""));
  if (Number.isNaN(base)) return null;
  const mult = m[2] ? COMPACT_MULTIPLIERS[m[2]] ?? 1 : 1;
  return Math.round(base * mult);
}

const UNIT_MS: Record<string, number> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
  year: 365 * 86_400_000,
  // Compact forms as served by lockup metadata ("3w ago", "36m ago", "1mo ago").
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 7 * 86_400_000,
  mo: 30 * 86_400_000,
  y: 365 * 86_400_000,
};

/**
 * Approximate age in ms from YouTube relative-time text: "3 days ago",
 * "3w ago", "Streamed 2 days ago". Null when unrecognized.
 */
export function approxAgeMs(text: string): number | null {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/^(streamed|premiered|updated)\s+/, "");
  const m = /^(\d+)\s*(second|minute|hour|day|week|month|year|mo|[smhdwy])s?\s+ago$/.exec(t);
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  const unit = UNIT_MS[m[2]];
  if (unit === undefined) return null;
  return Number(m[1]) * unit;
}
