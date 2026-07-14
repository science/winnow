// Transcript enrichment: watch page → ytInitialPlayerResponse →
// captionTracks → timedtext json3 → plain-text excerpt. Every step is
// best-effort; any failure returns null and scoring proceeds on metadata
// alone. NOTE: timedtext returns an empty body without a real browser
// session — verified working shapes, but the credentialed path needs
// in-browser confirmation (see QUESTIONS.md).

import { log } from "../../lib/logger";

export const TRANSCRIPT_EXCERPT_CHARS = 2000;

interface CaptionTrack {
  baseUrl?: string;
  languageCode?: string;
  kind?: string; // "asr" for auto-generated
}

/** Pull `var ytInitialPlayerResponse = {...}` from a watch page. */
export function extractPlayerResponse(html: string): unknown {
  const m = /var ytInitialPlayerResponse\s*=\s*(\{.*?\});(?:var|<\/script>)/s.exec(html);
  if (!m?.[1]) return null;
  try {
    return JSON.parse(m[1]);
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

/** Fetch a transcript excerpt for one video. Null on any failure. */
export async function fetchTranscriptExcerpt(
  videoId: string,
  maxChars: number = TRANSCRIPT_EXCERPT_CHARS,
): Promise<string | null> {
  try {
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      credentials: "include",
      headers: { "Accept-Language": "en-US,en;q=0.9" },
    });
    if (!pageRes.ok) return null;
    const player = extractPlayerResponse(await pageRes.text());
    const track = pickCaptionTrack(captionTracksFrom(player));
    if (!track?.baseUrl) return null;

    const ttRes = await fetch(`${track.baseUrl}&fmt=json3`, { credentials: "include" });
    if (!ttRes.ok) return null;
    const body = await ttRes.text();
    if (!body) return null;
    return parseJson3Transcript(JSON.parse(body), maxChars);
  } catch (err) {
    log.debug("transcript fetch failed for", videoId, err);
    return null;
  }
}
