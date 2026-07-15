// Temp probe (deleted after use): enrich one capture video live and rank it
// against the gotham target — shows exactly what the digest says.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseFeedPage } from "../src/services/youtube/feedParser";
import { enrichBatch, enrichmentModelFor } from "../src/services/scoring/twoPhase";
import { fetchTranscriptExcerpt } from "../src/services/youtube/transcripts";
import { ENRICH_TRANSCRIPT_CHARS } from "../src/services/scoring/enrichPrompt";
import { canonicalizeTarget, rankVideo } from "../src/lib/rubricScorer";

const here = dirname(fileURLToPath(import.meta.url));
const VIDEO = process.argv[2] ?? "PEopqMY5WCQ";

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
const video = videos.find((v) => v.id === VIDEO);
if (!video) throw new Error(`${VIDEO} not in capture`);
console.log("video:", JSON.stringify(video, null, 1));

const excerpt = await fetchTranscriptExcerpt(VIDEO, ENRICH_TRANSCRIPT_CHARS);
const transcript = "text" in excerpt ? excerpt.text : null;
console.log("transcript:", transcript ? `${transcript.length} chars` : JSON.stringify(excerpt));

const digests = await enrichBatch(
  [{ video, transcript }],
  "openai",
  process.env["OPENAI_API_KEY"]!,
  enrichmentModelFor("openai"),
);
const digest = digests.get(VIDEO)!;
console.log("digest:", JSON.stringify(digest, null, 1));

const target = canonicalizeTarget(bundle.scoring.target.target);
console.log("ranked vs captured (v2-translator) target:", rankVideo(digest, target));
