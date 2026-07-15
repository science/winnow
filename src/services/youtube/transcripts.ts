// Transcript enrichment via InnerTube player (ANDROID client) → timedtext.
//
// Why this route (established empirically, scripts/transcript-diag.ts):
//   - WEB-client caption URLs are proof-of-origin gated: timedtext answers
//     HTTP 200 with an empty body unless the request carries a `pot` token
//     only the real player's BotGuard can mint.
//   - InnerTube get_transcript now answers 400 FAILED_PRECONDITION for
//     every request shape we can produce — dead endpoint for us.
//   - The ANDROID-client player endpoint returns ungated caption URLs and
//     needs no API key, no cookies, and no watch-page fetch.
// Extension caveat: Firefox stamps our moz-extension:// Origin on the POST,
// which Google's anti-abuse layer rejects with a bot-block 403 — a DNR rule
// (public/dnr-rules.json) rewrites Origin to https://www.youtube.com.
// Both calls are cookie-less on purpose: the session adds nothing and a
// logged-in cookie jar with an ANDROID client claim looks anomalous.

import { log } from "../../lib/logger";

export const TRANSCRIPT_EXCERPT_CHARS = 2000;

// Reviewed constant (like model IDs). If YouTube retires this client
// version, the live e2e spec and scripts/transcript-diag.ts surface it.
export const ANDROID_CLIENT = {
  clientName: "ANDROID",
  clientVersion: "20.10.38",
  androidSdkVersion: 30,
} as const;

export interface TranscriptResult {
  excerpt: string;
  source: "player";
}

/** Per-stage failure marker so a 0/N run is self-diagnosing in the UI. */
export interface TranscriptFailure {
  failure: string;
}

export type TranscriptOutcome = TranscriptResult | TranscriptFailure;

/** Raw payloads from the most recent real transcript fetch — feeds the
 * Settings "Copy debug fixture" button so real shapes can become fixtures. */
export const lastTranscriptCapture: {
  current: {
    videoId: string;
    playerResponseRaw: string | null;
    timedtextRaw: string | null;
  } | null;
} = { current: null };

interface CaptionTrack {
  baseUrl?: string;
  languageCode?: string;
  kind?: string; // "asr" for auto-generated
}

/** Prefer a human-made English track, then ASR English, then anything. */
export function pickCaptionTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  const usable = tracks.filter((t) => t.baseUrl);
  if (usable.length === 0) return null;
  const en = usable.filter((t) => t.languageCode?.startsWith("en"));
  const manualEn = en.find((t) => t.kind !== "asr");
  return manualEn ?? en[0] ?? usable[0] ?? null;
}

/** Flatten timedtext fmt=json3 events into plain text. */
export function parseJson3Transcript(data: unknown, maxChars: number): string | null {
  const events = (data as { events?: Array<{ segs?: Array<{ utf8?: string }> }> })?.events;
  if (!Array.isArray(events)) return null;
  const parts: string[] = [];
  let length = 0;
  for (const e of events) {
    if (!Array.isArray(e.segs)) continue;
    const text = e.segs.map((s) => s.utf8 ?? "").join("").replace(/\n/g, " ").trim();
    if (!text) continue;
    parts.push(text);
    length += text.length + 1;
    if (length >= maxChars) break;
  }
  if (parts.length === 0) return null;
  return parts.join(" ").slice(0, maxChars);
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Flatten timedtext XML (`<timedtext format="3">`, the shape ANDROID-client
 * caption URLs serve regardless of fmt param) into plain text. Regex-based:
 * lib code must run without DOMParser (Node unit tests, workers). */
export function parseTimedtextXml(xml: string, maxChars: number): string | null {
  if (!xml.includes("<timedtext")) return null;
  const parts: string[] = [];
  let length = 0;
  for (const m of xml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)) {
    const text = decodeXmlEntities(m[1]!.replace(/<[^>]+>/g, ""))
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    parts.push(text);
    length += text.length + 1;
    if (length >= maxChars) break;
  }
  if (parts.length === 0) return null;
  return parts.join(" ").slice(0, maxChars);
}

export function captionTracksFrom(playerResponse: unknown): CaptionTrack[] {
  const tracks = (
    playerResponse as {
      captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
    }
  )?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  return Array.isArray(tracks) ? tracks : [];
}

/** Fetch a transcript excerpt for one video. Never throws; failures come
 * back as `{ failure: <stage> }` so callers can aggregate a breakdown.
 * `deps.fetchFn` is injectable for tests. */
export async function fetchTranscriptExcerpt(
  videoId: string,
  maxChars: number = TRANSCRIPT_EXCERPT_CHARS,
  deps: { fetchFn?: typeof fetch } = {},
): Promise<TranscriptOutcome> {
  const fetchFn = deps.fetchFn ?? fetch;
  try {
    const playerRes = await fetchFn(
      "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
      {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: { client: { ...ANDROID_CLIENT, hl: "en" } }, videoId }),
      },
    );
    if (!playerRes.ok) {
      log.warn(`InnerTube player rejected (${playerRes.status}) for ${videoId}`);
      return { failure: `player-http-${playerRes.status}` };
    }
    const playerRaw = await playerRes.text();
    let player: unknown;
    try {
      player = JSON.parse(playerRaw);
    } catch {
      return { failure: "player-parse" };
    }
    lastTranscriptCapture.current = { videoId, playerResponseRaw: playerRaw, timedtextRaw: null };

    const track = pickCaptionTrack(captionTracksFrom(player));
    if (!track?.baseUrl) return { failure: "no-tracks" };

    const ttRes = await fetchFn(`${track.baseUrl}&fmt=json3`, { credentials: "omit" });
    if (!ttRes.ok) return { failure: `timedtext-http-${ttRes.status}` };
    const body = await ttRes.text();
    if (!body) return { failure: "empty-body" };
    lastTranscriptCapture.current.timedtextRaw = body;

    let excerpt: string | null = null;
    if (body.trimStart().startsWith("{")) {
      try {
        excerpt = parseJson3Transcript(JSON.parse(body), maxChars);
      } catch {
        excerpt = null;
      }
    } else {
      excerpt = parseTimedtextXml(body, maxChars);
    }
    if (!excerpt) return { failure: "parse-null" };
    return { excerpt, source: "player" };
  } catch (err) {
    log.debug("transcript fetch failed for", videoId, err);
    return { failure: "network" };
  }
}
