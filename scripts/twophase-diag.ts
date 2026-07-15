// Diagnostic: run the REAL two-phase pipeline (translate → transcripts →
// enrich → rank) over real fixture-feed videos with live provider calls,
// and print the translated target, sample digests, and score histogram.
// Reproduces the production add-on run without a browser.
//
//   npx vite-node scripts/twophase-diag.ts [maxVideos] [provider]
//     --fixtures  score the committed parser fixtures instead of live pages
//     --capture   replay the committed gotham capture (pairs with
//                 DIAG_PROFILE=gotham for the exact mis-ranking feed)
//
// Keys from .env.production (gitignored) or the environment.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseFeedPage } from "../src/services/youtube/feedParser";
import { extractYtInitialData } from "../src/services/youtube/ytPage";
import { runTwoPhaseScoring, enrichmentModelFor } from "../src/services/scoring/twoPhase";
import { fetchTranscriptExcerpt } from "../src/services/youtube/transcripts";
import { isEmptyTarget } from "../src/lib/rubricScorer";
import { TIER_THRESHOLDS } from "../src/lib/tiers";
import type { EnrichmentEntry, Provider, Video } from "../src/lib/types";
import type { StoredTarget } from "../src/services/scoring/twoPhase";

const here = dirname(fileURLToPath(import.meta.url));

function loadEnv(): void {
  try {
    const raw = readFileSync(join(here, "..", ".env.production"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!;
    }
  } catch {
    /* env-only */
  }
}
loadEnv();

const maxVideos = Number(process.argv[2] ?? 40);
const provider = (process.argv[3] ?? "openai") as Provider;
const apiKey =
  provider === "openai" ? process.env["OPENAI_API_KEY"] : process.env["ANTHROPIC_API_KEY"];
if (!apiKey) {
  console.error(`no key for ${provider}`);
  process.exit(1);
}

// Approximation of a real profile of the kind the user runs; DIAG_PROFILE=nomatch
// swaps in a worst-case profile whose topics match nothing in the feed;
// DIAG_PROFILE=gotham is the verbatim profile behind the 2026-07 comic-chess
// mis-ranking (pair with --capture for the exact feed).
const profile =
  process.env["DIAG_PROFILE"] === "nomatch"
    ? {
        moreOf: "medieval falconry techniques, competitive yodeling championships",
        lessOf: "science provocateurs, overclaiming hype, clickbait",
        updatedAt: 0,
      }
    : process.env["DIAG_PROFILE"] === "gotham"
      ? {
          moreOf:
            "Chess videos featuring top tier play or top computer engine games of note.  Science and civil/mechanical/real-world engineering that is practical, professional or serious.",
          lessOf:
            "Computer science content, video games, sports, politics. Low tier comic chess games. Drama narratives on any subject. Click-bait subjects or attention grabbing material. Standup comedy. Science provocateurs, overclaiming hype.",
          updatedAt: 0,
        }
      : {
        moreOf:
          "deep chess analysis and lessons, careful science and engineering explainers, programming and systems design deep dives, history documentaries",
        lessOf:
          "science provocateurs and overclaiming hype, clickbait, celebrity drama, reaction content, shorts-style filler",
        updatedAt: 0,
      };

function fixtureVideos(): Video[] {
  const fixtures: Array<{ file: string; source: "home" | "subscriptions" }> = [
    { file: "home-real-signedin.json", source: "home" },
    { file: "subscriptions-real-signedin.json", source: "subscriptions" },
  ];
  const all: Video[] = [];
  const seen = new Set<string>();
  for (const { file, source } of fixtures) {
    const data = JSON.parse(
      readFileSync(join(here, "..", "src", "services", "youtube", "fixtures", file), "utf8"),
    ) as unknown;
    for (const v of parseFeedPage(data, source)) {
      if (!seen.has(v.id)) {
        seen.add(v.id);
        all.push(v);
      }
    }
  }
  return all.slice(0, maxVideos);
}

// The committed production-scale capture (126 videos around the gotham
// mis-ranking), gunzipped to a gitignored local copy on first use.
function captureVideos(): Video[] {
  const dir = join(here, "..", "src", "services", "youtube", "fixtures");
  const jsonPath = join(dir, "gotham-poor-ranking-capture.json");
  if (!existsSync(jsonPath)) {
    writeFileSync(jsonPath, gunzipSync(readFileSync(`${jsonPath}.gz`)));
  }
  const bundle = JSON.parse(readFileSync(jsonPath, "utf8")) as Record<string, unknown>;
  const all: Video[] = [];
  const seen = new Set<string>();
  for (const source of ["home", "subscriptions"] as const) {
    for (const v of parseFeedPage(bundle[source], source)) {
      if (!seen.has(v.id)) {
        seen.add(v.id);
        all.push(v);
      }
    }
  }
  return all.slice(0, maxVideos);
}

// A diverse real feed at production scale: several channels' /videos pages
// (signed-out; same ytInitialData shape the parser handles) mixing on-profile
// and off-profile content like a real home feed does.
const CHANNELS = [
  "@GMHikaru", "@agadmator", "@veritasium", "@kurzgesagt", "@ComputerphileVideos",
  "@PowerfulJRE", "@MrBeast", "@BingingwithBabish", "@LinusTechTips", "@CNN",
  "@SidemenReacts", "@baumgartnerrestoration",
];

async function liveVideos(): Promise<Video[]> {
  const all: Video[] = [];
  const seen = new Set<string>();
  const perChannel = Math.ceil(maxVideos / CHANNELS.length);
  for (const ch of CHANNELS) {
    try {
      const res = await fetch(`https://www.youtube.com/${ch}/videos?hl=en`, {
        headers: { "Accept-Language": "en-US,en;q=0.9" },
      });
      const html = await res.text();
      const data = extractYtInitialData(html);
      const vids = parseFeedPage(data, "home").slice(0, perChannel);
      process.stderr.write(`  ${ch}: ${vids.length} videos\n`);
      for (const v of vids) {
        if (!seen.has(v.id)) {
          seen.add(v.id);
          all.push(v);
        }
      }
    } catch (err) {
      process.stderr.write(`  ${ch}: FAILED ${err instanceof Error ? err.message : err}\n`);
    }
  }
  return all.slice(0, maxVideos);
}

async function main(): Promise<void> {
  const videos = process.argv.includes("--capture")
    ? captureVideos()
    : process.argv.includes("--fixtures")
      ? fixtureVideos()
      : await liveVideos();
  const model = enrichmentModelFor(provider);
  console.log(`${videos.length} fixture videos, provider=${provider}, model=${model}\n`);

  // In-memory caches — a cold first run, like the user's.
  let enrichmentCache: Record<string, EnrichmentEntry> | null = null;
  let storedTarget: StoredTarget | null = null;

  const t0 = Date.now();
  const result = await runTwoPhaseScoring(videos, {
    provider,
    apiKey: apiKey!,
    model,
    profile,
    feedback: [],
    fetchExcerpt: (id, maxChars) => fetchTranscriptExcerpt(id, maxChars),
    loadEnrichment: async () => enrichmentCache,
    saveEnrichment: async (c) => {
      enrichmentCache = c;
    },
    loadTarget: async () => storedTarget,
    saveTarget: async (s) => {
      storedTarget = s;
    },
    onProgress: (done, total) => process.stderr.write(`\r  enrich ${done}/${total} `),
  });
  console.log(`\nrun took ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  console.log("\n=== TARGET (canonical) ===");
  console.log(JSON.stringify(result.target, null, 2));
  console.log("empty target?", isEmptyTarget(result.target));

  console.log("\n=== TRANSCRIPTS ===");
  console.log(
    `${result.transcripts.fetched}/${result.transcripts.attempted}`,
    result.transcripts.failures,
  );
  console.log(`enriched: ${result.enriched}, unknown: ${result.unknownIds.length}`);
  if (result.fatalError) console.log("FATAL:", result.fatalError.kind, result.fatalError.message);

  console.log("\n=== SAMPLE DIGESTS ===");
  const entries = Object.entries(enrichmentCache ?? {}).slice(0, 6);
  for (const [id, e] of entries) {
    const v = videos.find((x) => x.id === id);
    const d = e.digest;
    console.log(
      `- ${v?.title?.slice(0, 60)}\n    topics=[${d.topics.join(", ")}] format=${d.format} tone=${d.emotionalTone}\n    sub=${d.substanceDensity} cb=${d.clickbaitSeverity} over=${d.claimOverreach} demand=${d.intellectualDemand} prod=${d.productionEffort} nov=${d.novelty} transcript=${e.hadTranscript}`,
    );
  }

  console.log("\n=== SCORES ===");
  const scores = Object.entries(result.scores);
  const hist = new Map<string, number>();
  let top = 0,
    worth = 0,
    winnowed = 0;
  for (const [, s] of scores) {
    const bucket = `${Math.floor(s.score / 10) * 10}s`;
    hist.set(bucket, (hist.get(bucket) ?? 0) + 1);
    if (s.score >= TIER_THRESHOLDS.top && !s.clickbait) top++;
    else if (s.score >= TIER_THRESHOLDS.worthALook) worth++;
    else winnowed++;
  }
  console.log(
    [...hist.entries()].sort((a, b) => parseInt(a[0]) - parseInt(b[0])).map(([b, n]) => `${b}: ${n}`).join("  "),
  );
  console.log(`tiers → top=${top} worthALook=${worth} winnowed=${winnowed} (of ${scores.length} scored)`);

  console.log("\n=== PER-VIDEO ===");
  const sorted = scores
    .map(([id, s]) => ({ id, s, v: videos.find((x) => x.id === id) }))
    .sort((a, b) => b.s.score - a.s.score);
  for (const { s, v } of sorted) {
    console.log(`${String(s.score).padStart(3)}  ${s.clickbait ? "CB" : "  "}  ${v?.title?.slice(0, 55)}  | ${s.reason}`);
  }
}

void main();
