// Renders the translated profile target (winnow:profileTarget:v1) as plain
// lines for the Settings "How Winnow read your profile" panel — the ranking
// criteria are derived from the user's own words, and this is where they
// get to audit that derivation.

import { DIGEST_NUMERIC_FIELDS, type DigestNumericField, type ProfileTarget } from "./types";

const FIELD_LABELS: Record<DigestNumericField, string> = {
  substanceDensity: "Substance density",
  clickbaitSeverity: "Clickbait severity",
  claimOverreach: "Claim overreach",
  intellectualDemand: "Intellectual demand",
  productionEffort: "Production effort",
  novelty: "Novelty",
};

const LIST_LABELS = [
  ["topicsMore", "Topics sought"],
  ["topicsLess", "Topics avoided"],
  ["formatsAvoid", "Formats avoided"],
  ["tonesAvoid", "Tones avoided"],
] as const;

/** Human-readable lines for every active constraint; empty for an empty
 * target (caller shows its own empty state). */
export function describeTarget(target: ProfileTarget): string[] {
  const lines: string[] = [];
  for (const field of DIGEST_NUMERIC_FIELDS) {
    const ft = target.fields[field];
    if (!ft || ft.importance <= 0) continue;
    lines.push(`${FIELD_LABELS[field]}: aim ${ft.target}/5 — importance ${ft.importance}/10`);
  }
  for (const [key, label] of LIST_LABELS) {
    const list = target[key];
    if (list.items.length === 0 || list.importance <= 0) continue;
    lines.push(`${label}: ${list.items.join(", ")} — importance ${list.importance}/10`);
  }
  return lines;
}
