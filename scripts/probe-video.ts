// Diagnostic: enrich ONE video with a live cheap-model call and rank it —
// shows exactly what the digest says when a single ranking looks wrong.
// Videos from the committed gotham capture carry their real metadata; any
// other id gets a synthesized Video from the flags (the transcript is
// always fetched live).
//
//   npx vite-node scripts/probe-video.ts [videoId] [flags]
//     --title=...     synthesized metadata for ids outside the capture
//     --channel=...
//     --duration=...  e.g. 21:30
//     --fresh-target  rank against a live translation of the diag profile
//                     (DIAG_MORE/DIAG_LESS override) instead of the
//                     capture's stored (stale, v2-translator) target
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseFeedPage } from "../src/services/youtube/feedParser";
import { enrichBatch, enrichmentModelFor, translateProfile } from "../src/services/scoring/twoPhase";
import { fetchTranscriptExcerpt } from "../src/services/youtube/transcripts";
import { ENRICH_TRANSCRIPT_CHARS } from "../src/services/scoring/enrichPrompt";
import { canonicalizeTarget, rankVideo } from "../src/lib/rubricScorer";
import { describeTarget } from "../src/lib/targetDisplay";
import type { Video } from "../src/lib/types";
import { DIAG_DEFAULT_PROFILE } from "./diagProfile";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name: string): string | null =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const VIDEO = args.find((a) => !a.startsWith("--")) ?? "PEopqMY5WCQ";
const freshTarget = args.includes("--fresh-target");

for (const line of readFileSync(join(here, "..", ".env.production"), "utf8").split("\n")) {
  const m = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!;
}

const dir = join(here, "..", "src", "services", "youtube", "fixtures");
const jsonPath = join(dir, "gotham-poor-ranking-capture.json");
if (!existsSync(jsonPath)) writeFileSync(jsonPath, gunzipSync(readFileSync(`${jsonPath}.gz`)));
const bundle = JSON.parse(readFileSync(jsonPath, "utf8"));
const videos = [
  ...parseFeedPage(bundle.home, "home"),
  ...parseFeedPage(bundle.subscriptions, "subscriptions"),
];
const durationText = flag("duration");
const video: Video = videos.find((v) => v.id === VIDEO) ?? {
  id: VIDEO,
  source: "home",
  title: flag("title") ?? "(unknown — pass --title=...)",
  channelTitle: flag("channel"),
  channelId: null,
  durationText,
  durationSec: null,
  publishedText: null,
  publishedAtApprox: null,
  viewCountText: null,
  viewCount: null,
  thumbnailUrl: null,
  descriptionSnippet: null,
  isLive: false,
};
console.log("video:", JSON.stringify(video, null, 1));

const excerpt = await fetchTranscriptExcerpt(VIDEO, ENRICH_TRANSCRIPT_CHARS);
const transcript = "excerpt" in excerpt ? excerpt.excerpt : null;
console.log("transcript:", transcript ? `${transcript.length} chars` : JSON.stringify(excerpt));

const apiKey = process.env["OPENAI_API_KEY"]!;
const model = enrichmentModelFor("openai");
const digests = await enrichBatch([{ video, transcript }], "openai", apiKey, model);
const digest = digests.get(VIDEO)!;
console.log("digest:", JSON.stringify(digest, null, 1));

const target = freshTarget
  ? await translateProfile(DIAG_DEFAULT_PROFILE, [], "openai", apiKey, model)
  : canonicalizeTarget(bundle.scoring.target.target);
console.log(freshTarget ? "fresh-translated target:" : "captured (v2-translator) target:");
for (const line of describeTarget(target)) console.log(` ${line}`);
console.log("ranked:", rankVideo(digest, target));
