// Offline tuning for cut-score ranking (docs/CUT_SCORE_RANKING.md §6).
// Loads digests dumped by `twophase-diag.ts --dump=<path>`, holds the target
// fixed, and sweeps the topic-weight floor × veto rule, printing the resulting
// tier distribution for each cell. Pure and deterministic — no API calls — so
// constants get chosen from a table instead of intuition (the July 2026
// feed-collapse came from intuiting them).
//
//   npx vite-node scripts/rank-sweep.ts <dump.json>
//
// The floor is simulated by raising topicsMore.importance, which IS the weight
// contributions() uses, so this exercises the real rankVideo rather than a
// reimplementation that could drift from it.

import { readFileSync } from "node:fs";
import { rankVideo, matchedTopics } from "../src/lib/rubricScorer";
import { TIER_THRESHOLDS } from "../src/lib/tiers";
import type { ProfileTarget, VideoDigest } from "../src/services/scoring/types";

interface DumpEntry {
  title: string | null;
  channelTitle: string | null;
  hadTranscript: boolean;
  digest: VideoDigest;
}

const path = process.argv[2];
if (!path) {
  console.error("usage: npx vite-node scripts/rank-sweep.ts <dump.json>");
  process.exit(1);
}
const dump = JSON.parse(readFileSync(path, "utf8")) as {
  target: ProfileTarget;
  digests: Record<string, DumpEntry>;
};
const entries = Object.values(dump.digests);
const baseTarget = dump.target;

const otherWeight =
  Object.values(baseTarget.fields).reduce((s, f) => s + (f?.importance ?? 0), 0) +
  baseTarget.topicsLess.importance;

console.log(`${entries.length} digests; topicsMore importance=${baseTarget.topicsMore.importance}, other weights=${otherWeight}`);
console.log(`seek topics: ${baseTarget.topicsMore.items.join(", ")}\n`);

// The quality veto and the topic-weight floor now live INSIDE rankVideo, so
// they are no longer sweepable from here — the `+0` row below IS the shipped
// behavior. What remains sweepable is raising the topic weight FURTHER, which
// is the knob to revisit if off-profile content creeps back into Top picks.
console.log("extra topic weight above the built-in floor:");
console.log("  +w   top  worth  winnow | off-profile share of top");
for (const extra of [0, 5, 10, 20, 40]) {
  const importance = baseTarget.topicsMore.importance + extra;
  const target: ProfileTarget = {
    ...baseTarget,
    topicsMore: { ...baseTarget.topicsMore, importance },
  };
  let top = 0,
    worth = 0,
    winnow = 0,
    topOff = 0;
  for (const e of entries) {
    const r = rankVideo(e.digest, target);
    // Bucketing must mirror tiers.ts exactly or the table describes a feed
    // the user will never see.
    if (r.score >= TIER_THRESHOLDS.top && !r.clickbait) {
      top++;
      if (matchedTopics(e.digest.topics, baseTarget.topicsMore.items).length === 0) topOff++;
    } else if (r.score >= TIER_THRESHOLDS.worthALook) worth++;
    else winnow++;
  }
  console.log(
    `${String(extra).padStart(4)}  ${String(top).padStart(4)}  ${String(worth).padStart(5)}  ${String(winnow).padStart(6)} | ${top === 0 ? "   n/a" : `${((100 * topOff) / top).toFixed(0).padStart(4)}%`} (${topOff})`,
  );
}

// Veto volume, reported separately since it is no longer a swept dimension.
const vetoed = entries.filter((e) => rankVideo(e.digest, baseTarget).capped);
console.log(`\ncapped (avoided topic or quality veto): ${vetoed.length}/${entries.length}`);
for (const e of vetoed.slice(0, 12)) {
  const d = e.digest;
  console.log(`  cb=${d.clickbaitSeverity} ov=${d.claimOverreach} sub=${d.substanceDensity}  ${(e.title ?? "").slice(0, 58)}`);
}
