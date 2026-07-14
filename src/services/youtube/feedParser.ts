// The fragility boundary: everything in this file parses YouTube's
// undocumented ytInitialData tree. Rules (see CLAUDE.md): parse
// defensively, never throw, skip items we don't understand, and keep the
// recognized surface minimal. The walker collects known leaf renderers
// wherever they appear rather than pinning exact page paths, so layout
// reshuffles don't break us — only leaf-shape changes do.

import type { FeedSource, Video } from "../../lib/types";
import { approxAgeMs, parseDurationText, parseViewCountText } from "../../lib/format";
import { log } from "../../lib/logger";

type Json = Record<string, unknown>;

function isObj(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Read `runs[].text` or `simpleText` — YouTube's two text encodings. */
function ytText(v: unknown): string | null {
  if (!isObj(v)) return null;
  const simple = str(v["simpleText"]);
  if (simple) return simple;
  const runs = v["runs"];
  if (Array.isArray(runs)) {
    const joined = runs
      .map((r) => (isObj(r) ? str(r["text"]) ?? "" : ""))
      .join("");
    return joined.length > 0 ? joined : null;
  }
  return null;
}

function largestThumbnail(thumbnails: unknown): string | null {
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) return null;
  let best: { url: string; width: number } | null = null;
  for (const t of thumbnails) {
    if (!isObj(t)) continue;
    const url = str(t["url"]);
    if (!url) continue;
    const width = typeof t["width"] === "number" ? t["width"] : 0;
    if (!best || width > best.width) best = { url, width };
  }
  return best?.url ?? null;
}

function deepFind(node: unknown, key: string): unknown {
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = deepFind(item, key);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  if (isObj(node)) {
    if (node[key] !== undefined) return node[key];
    for (const v of Object.values(node)) {
      const hit = deepFind(v, key);
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}

/** Legacy shape: videoRenderer / gridVideoRenderer. */
function parseVideoRenderer(r: Json, source: FeedSource): Video | null {
  const id = str(r["videoId"]);
  const title = ytText(r["title"]);
  if (!id || !title) return null;

  const owner = r["ownerText"] ?? r["longBylineText"] ?? r["shortBylineText"];
  const channelTitle = ytText(owner);
  let channelId: string | null = null;
  const browse = deepFind(owner, "browseEndpoint");
  if (isObj(browse)) channelId = str(browse["browseId"]);

  const badges = r["badges"];
  const isLive =
    Array.isArray(badges) &&
    badges.some(
      (b) =>
        isObj(b) &&
        isObj(b["metadataBadgeRenderer"]) &&
        str((b["metadataBadgeRenderer"] as Json)["style"]) === "BADGE_STYLE_TYPE_LIVE_NOW",
    );

  const durationText = isLive ? null : ytText(r["lengthText"]);
  const publishedText = ytText(r["publishedTimeText"]);
  const viewCountText = ytText(r["viewCountText"]);
  const thumb = isObj(r["thumbnail"]) ? (r["thumbnail"] as Json)["thumbnails"] : null;

  return {
    id,
    source,
    title,
    channelTitle,
    channelId,
    durationText,
    durationSec: durationText ? parseDurationText(durationText) : null,
    publishedText,
    publishedAtApprox: publishedAtFrom(publishedText),
    viewCountText,
    viewCount: viewCountText ? parseViewCountText(viewCountText) : null,
    thumbnailUrl: largestThumbnail(thumb),
    descriptionSnippet:
      ytText(r["descriptionSnippet"]) ??
      ytText(Array.isArray(r["detailedMetadataSnippets"]) ? deepFind(r["detailedMetadataSnippets"], "snippetText") : null),
    isLive,
  };
}

/** Modern shape: lockupViewModel (2024+ view-model architecture). */
function parseLockup(l: Json, source: FeedSource): Video | null {
  if (str(l["contentType"]) !== "LOCKUP_CONTENT_TYPE_VIDEO") return null;
  const id = str(l["contentId"]);
  const md = deepFind(l["metadata"], "lockupMetadataViewModel");
  if (!id || !isObj(md)) return null;
  const title = isObj(md["title"]) ? str((md["title"] as Json)["content"]) : null;
  if (!title) return null;

  // Metadata rows: [channel?] then [views, age]. Rows are display text;
  // classify parts by shape rather than position.
  let channelTitle: string | null = null;
  let channelId: string | null = null;
  let viewCountText: string | null = null;
  let publishedText: string | null = null;
  const rows = deepFind(md["metadata"], "metadataRows");
  if (Array.isArray(rows)) {
    for (const row of rows) {
      const parts = isObj(row) ? row["metadataParts"] : null;
      if (!Array.isArray(parts)) continue;
      for (const part of parts) {
        if (!isObj(part) || !isObj(part["text"])) continue;
        const textObj = part["text"] as Json;
        const content = str(textObj["content"]);
        if (!content) continue;
        if (/\bview(s)?\b|\bwatching\b/i.test(content) || /^[\d.,]+[KMB]?$/.test(content)) {
          viewCountText = viewCountText ?? content;
        } else if (approxAgeMs(content) !== null) {
          publishedText = publishedText ?? content;
        } else if (!channelTitle) {
          channelTitle = content;
          const browse = deepFind(textObj["commandRuns"], "browseEndpoint");
          if (isObj(browse)) channelId = str(browse["browseId"]);
        }
      }
    }
  }

  // Duration badge lives in the thumbnail overlay.
  let durationText: string | null = null;
  let isLive = false;
  const badge = deepFind(l["contentImage"], "thumbnailBadgeViewModel");
  if (isObj(badge)) {
    const badgeText = str(badge["text"]);
    if (badgeText && parseDurationText(badgeText) !== null) durationText = badgeText;
    if (badgeText === "LIVE" || str(badge["badgeStyle"])?.includes("LIVE")) isLive = true;
  }

  const sources = deepFind(l["contentImage"], "sources");

  return {
    id,
    source,
    title,
    channelTitle,
    channelId,
    durationText,
    durationSec: durationText ? parseDurationText(durationText) : null,
    publishedText,
    publishedAtApprox: publishedAtFrom(publishedText),
    viewCountText,
    viewCount: viewCountText ? parseViewCountText(viewCountText) : null,
    thumbnailUrl: largestThumbnail(sources),
    descriptionSnippet: null,
    isLive,
  };
}

function publishedAtFrom(publishedText: string | null): number | null {
  if (!publishedText) return null;
  const age = approxAgeMs(publishedText);
  return age === null ? null : Date.now() - age;
}

// Leaf renderer keys we recognize as videos. Shorts (shortsLockupViewModel,
// reelItemRenderer) and ads (adSlotRenderer) are deliberately absent.
const VIDEO_KEYS = new Set(["videoRenderer", "gridVideoRenderer", "compactVideoRenderer"]);

// Container subtrees skipped wholesale: advertiser/brand promo shelves hold
// ordinary videoRenderers, but they're injected promotion, not the feed.
const SKIP_SUBTREE_KEYS = new Set(["brandVideoShelfRenderer"]);

/**
 * Extract all videos from a ytInitialData tree (any feed page shape).
 * Never throws; unrecognized structures yield an empty list.
 */
export function parseFeedPage(data: unknown, source: FeedSource): Video[] {
  const videos: Video[] = [];
  const seen = new Set<string>();

  function add(v: Video | null): void {
    if (v && !seen.has(v.id)) {
      seen.add(v.id);
      videos.push(v);
    }
  }

  function walk(node: unknown): void {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!isObj(node)) return;
    for (const [key, value] of Object.entries(node)) {
      if (SKIP_SUBTREE_KEYS.has(key)) continue;
      if (!isObj(value)) {
        walk(value);
        continue;
      }
      try {
        if (VIDEO_KEYS.has(key)) {
          add(parseVideoRenderer(value, source));
          continue;
        }
        if (key === "lockupViewModel") {
          add(parseLockup(value, source));
          continue;
        }
      } catch (err) {
        // One malformed item must never take down the page parse.
        log.warn("feedParser: skipping malformed item", key, err);
        continue;
      }
      walk(value);
    }
  }

  try {
    walk(data);
  } catch (err) {
    log.error("feedParser: walk failed", err);
    return videos;
  }
  return videos;
}
