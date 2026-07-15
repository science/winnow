// Compact, pasteable snapshot of the two-phase scoring state for the
// Settings debug capture: the translated target verbatim (it's small and
// it's usually the answer), and score/enrichment distributions instead of
// full content — enough to diagnose a feed collapse from one paste.

import { DIGEST_NUMERIC_FIELDS, type EnrichmentEntry, type VideoScore } from "./types";
import { TIER_THRESHOLDS } from "./tiers";

export interface ScoringDebugInput {
  /** Stored profile target (winnow:profileTarget:v1), verbatim. */
  target: unknown;
  scores: Record<string, VideoScore> | null;
  enrichment: Record<string, EnrichmentEntry> | null;
}

export interface ScoringDebug {
  target: unknown;
  scores: {
    count: number;
    tiers: { top: number; worthALook: number; winnowed: number };
    histogram: Record<string, number>;
  };
  enrichment: {
    count: number;
    withTranscript: number;
    axisMeans: Record<string, number>;
    formats: Record<string, number>;
  };
}

export function buildScoringDebug(input: ScoringDebugInput): ScoringDebug {
  const scores = Object.values(input.scores ?? {});
  const histogram: Record<string, number> = {};
  const tiers = { top: 0, worthALook: 0, winnowed: 0 };
  for (const s of scores) {
    const bucket = `${Math.floor(s.score / 10) * 10}s`;
    histogram[bucket] = (histogram[bucket] ?? 0) + 1;
    if (s.score >= TIER_THRESHOLDS.top && !s.clickbait) tiers.top += 1;
    else if (s.score >= TIER_THRESHOLDS.worthALook) tiers.worthALook += 1;
    else tiers.winnowed += 1;
  }

  const entries = Object.values(input.enrichment ?? {});
  const axisMeans: Record<string, number> = {};
  const formats: Record<string, number> = {};
  let withTranscript = 0;
  for (const field of DIGEST_NUMERIC_FIELDS) {
    const sum = entries.reduce((acc, e) => acc + e.digest[field], 0);
    if (entries.length > 0) axisMeans[field] = Math.round((sum / entries.length) * 100) / 100;
  }
  for (const e of entries) {
    if (e.hadTranscript) withTranscript += 1;
    formats[e.digest.format] = (formats[e.digest.format] ?? 0) + 1;
  }

  return {
    target: input.target,
    scores: { count: scores.length, tiers, histogram },
    enrichment: { count: entries.length, withTranscript, axisMeans, formats },
  };
}
