// Transcript enrichment, two paths tried in order per video:
//   1. timedtext — watch page → ytInitialPlayerResponse → captionTracks →
//      timedtext json3 (known to return an empty body in some sessions,
//      suspected proof-of-origin gating);
//   2. InnerTube get_transcript — ytcfg apiKey/clientVersion + the watch
//      page's getTranscriptEndpoint params, cookies-only auth.
// Every step is best-effort; any failure returns null and scoring proceeds
// on metadata alone. In-browser verification tracked in QUESTIONS.md.

import { log } from "../../lib/logger";
import { sapisidHashHeader, YOUTUBE_ORIGIN } from "../../lib/sapisidHash";
import { getSapisid } from "./authCookies";
import { extractJsonBlob } from "./pageExtract";
import { extractInnertubeConfig, extractYtInitialData } from "./ytPage";

export const TRANSCRIPT_EXCERPT_CHARS = 2000;

export interface TranscriptResult {
  excerpt: string;
  source: "timedtext" | "innertube";
}

/** Raw payloads from the most recent real transcript fetch — feeds the
 * Settings "Copy debug fixture" button so real shapes can become fixtures. */
export const lastTranscriptCapture: {
  current: {
    videoId: string;
    playerResponseRaw: string | null;
    ytInitialDataRaw: string | null;
    innertubeResponseRaw: string | null;
  } | null;
} = { current: null };

interface CaptionTrack {
  baseUrl?: string;
  languageCode?: string;
  kind?: string; // "asr" for auto-generated
}

/** Pull `var ytInitialPlayerResponse = {...}` from a watch page. */
export function extractPlayerResponse(html: string): unknown {
  const raw = extractJsonBlob(html, /var ytInitialPlayerResponse\s*=\s*/);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
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

export function captionTracksFrom(playerResponse: unknown): CaptionTrack[] {
  const tracks = (
    playerResponse as {
      captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
    }
  )?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  return Array.isArray(tracks) ? tracks : [];
}

/** Deep-walk the watch page's ytInitialData for the transcript panel's
 * getTranscriptEndpoint params (needed by InnerTube get_transcript). */
export function extractTranscriptParams(ytInitialData: unknown): string | null {
  let found: string | null = null;
  const walk = (node: unknown): void => {
    if (found || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const obj = node as Record<string, unknown>;
    const endpoint = obj["getTranscriptEndpoint"] as { params?: unknown } | undefined;
    if (endpoint && typeof endpoint.params === "string" && endpoint.params) {
      found = endpoint.params;
      return;
    }
    for (const value of Object.values(obj)) walk(value);
  };
  walk(ytInitialData);
  return found;
}

/** Flatten an InnerTube get_transcript response into plain text. Tolerant
 * deep-walk over both the current segment shape and the older cue shape. */
export function parseInnertubeTranscript(data: unknown, maxChars: number): string | null {
  const parts: string[] = [];
  let length = 0;
  const push = (text: string): void => {
    const cleaned = text.replace(/\n/g, " ").trim();
    if (!cleaned) return;
    parts.push(cleaned);
    length += cleaned.length + 1;
  };
  const walk = (node: unknown): void => {
    if (length >= maxChars || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const obj = node as Record<string, unknown>;
    const segment = obj["transcriptSegmentRenderer"] as
      | { snippet?: { runs?: Array<{ text?: string }>; simpleText?: string } }
      | undefined;
    if (segment?.snippet) {
      const runs = segment.snippet.runs;
      const text = Array.isArray(runs)
        ? runs.map((r) => r.text ?? "").join("")
        : (segment.snippet.simpleText ?? "");
      push(text);
      return;
    }
    const cue = obj["transcriptCueRenderer"] as { cue?: { simpleText?: string } } | undefined;
    if (cue?.cue?.simpleText) {
      push(cue.cue.simpleText);
      return;
    }
    for (const value of Object.values(obj)) walk(value);
  };
  walk(data);
  if (parts.length === 0) return null;
  return parts.join(" ").slice(0, maxChars);
}

/** InnerTube get_transcript fallback, signed with SAPISIDHASH when the
 * SAPISID cookie is readable (cookies permission; extension context only).
 * Without it the request is cookies-only, which some sessions reject with
 * 401/403 — logged distinctively, null returned. */
export async function fetchTranscriptInnertube(
  html: string,
  videoId: string,
  maxChars: number,
  fetchFn: typeof fetch,
  getSapisidFn: () => Promise<string | null> = getSapisid,
): Promise<string | null> {
  const cfg = extractInnertubeConfig(html);
  if (!cfg) return null;
  const params = extractTranscriptParams(extractYtInitialData(html));
  if (!params) return null;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const sapisid = await getSapisidFn();
  if (sapisid) {
    // The hash claims YOUTUBE_ORIGIN; the browser still sends the real
    // moz-extension Origin (forbidden header), so X-Origin carries the claim.
    headers["Authorization"] = await sapisidHashHeader(sapisid, YOUTUBE_ORIGIN);
    headers["X-Origin"] = YOUTUBE_ORIGIN;
    headers["X-Goog-AuthUser"] = "0";
  }

  const res = await fetchFn(
    `https://www.youtube.com/youtubei/v1/get_transcript?key=${cfg.apiKey}&prettyPrint=false`,
    {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({
        context: { client: { clientName: "WEB", clientVersion: cfg.clientVersion, hl: "en" } },
        params,
      }),
    },
  );
  if (res.status === 401 || res.status === 403) {
    log.warn(
      `InnerTube get_transcript rejected (${res.status}) for ${videoId} — ${
        sapisid ? "even with SAPISIDHASH auth (Origin-claim contingency, see QUESTIONS.md)" : "no SAPISID cookie readable, cookies-only auth insufficient"
      }`,
    );
    return null;
  }
  if (!res.ok) return null;
  const raw = await res.text();
  if (lastTranscriptCapture.current?.videoId === videoId) {
    lastTranscriptCapture.current.innertubeResponseRaw = raw;
  }
  return parseInnertubeTranscript(JSON.parse(raw), maxChars);
}

/** Fetch a transcript excerpt for one video: timedtext first, InnerTube
 * fallback. Null on any failure. `deps.fetchFn` is injectable for tests. */
export async function fetchTranscriptExcerpt(
  videoId: string,
  maxChars: number = TRANSCRIPT_EXCERPT_CHARS,
  deps: { fetchFn?: typeof fetch; getSapisidFn?: () => Promise<string | null> } = {},
): Promise<TranscriptResult | null> {
  const fetchFn = deps.fetchFn ?? fetch;
  const getSapisidFn = deps.getSapisidFn ?? getSapisid;
  try {
    const pageRes = await fetchFn(`https://www.youtube.com/watch?v=${videoId}`, {
      credentials: "include",
      headers: { "Accept-Language": "en-US,en;q=0.9" },
    });
    if (!pageRes.ok) return null;
    const html = await pageRes.text();
    lastTranscriptCapture.current = {
      videoId,
      playerResponseRaw: extractJsonBlob(html, /var ytInitialPlayerResponse\s*=\s*/),
      ytInitialDataRaw: extractJsonBlob(html, /var ytInitialData\s*=\s*/),
      innertubeResponseRaw: null,
    };

    try {
      const player = extractPlayerResponse(html);
      const track = pickCaptionTrack(captionTracksFrom(player));
      if (track?.baseUrl) {
        const ttRes = await fetchFn(`${track.baseUrl}&fmt=json3`, { credentials: "include" });
        if (ttRes.ok) {
          const body = await ttRes.text();
          if (body) {
            const excerpt = parseJson3Transcript(JSON.parse(body), maxChars);
            if (excerpt) return { excerpt, source: "timedtext" };
          }
        }
      }
    } catch (err) {
      log.debug("timedtext path failed for", videoId, err);
    }

    const excerpt = await fetchTranscriptInnertube(html, videoId, maxChars, fetchFn, getSapisidFn);
    if (excerpt) return { excerpt, source: "innertube" };
    return null;
  } catch (err) {
    log.debug("transcript fetch failed for", videoId, err);
    return null;
  }
}
