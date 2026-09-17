// The watch-history ping, as yt-dlp's `_mark_watched` sends it. Embedded
// players report plays as `el=embedded`, which YouTube does not record to
// watch history (measured 2026-09-16 with the signed-in player); a watch
// page's own playback ping does. Measured the same day: the playback ping
// alone at cmt=0 records the entry.
//
// Watch DURATION is not reportable. Measured 2026-09-17 against the history
// page's progress bar: the real watch page's watchtime pings move it, but
// neither the embed's own watchtime pings nor any watchtime ping Winnow
// built (yt-dlp style, the watch page's full parameter/header set, its
// session token, youtube.com Origin/Referer, real-time 10 s cadence) did.
// So Winnow controls WHEN a play is recorded instead: only after the user
// has actually watched a while, so a mis-click or a quick bail-out never
// lands in history.

/** Watched seconds before a play is recorded in history. */
export const HISTORY_MIN_WATCH_SEC = 30;
/** Fastest playback YouTube offers; faster position changes are seeks. */
const MAX_PLAYBACK_RATE = 2;
/** Slack for sample jitter, in seconds. */
const CREDIT_SLACK_SEC = 1;

const CPN_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
const PING_ORIGIN = "https://s.youtube.com";
const PING_PATH = "/api/stats/playback";

/** A client playback nonce: 16 characters, each a byte's low six bits
 *  (the algorithm yt-dlp reverse-engineered from YouTube's base.js). */
export function generateCpn(bytes: Uint8Array): string {
  return Array.from(bytes.slice(0, 16), (b) => CPN_ALPHABET[b & 63]).join("");
}

/** The playback ping for a watch page's `videostatsPlaybackUrl`. Throws on
 *  anything but YouTube's playback stats endpoint: the URL comes from a
 *  fetched page, and it is sent with the user's cookies. */
export function playbackPingUrl(trackingUrl: string, cpn: string): string {
  const url = new URL(trackingUrl);
  if (url.origin !== PING_ORIGIN || url.pathname !== PING_PATH) {
    throw new Error(`unexpected playback tracking URL: ${url.origin}${url.pathname}`);
  }
  url.searchParams.set("ver", "2");
  url.searchParams.set("cpn", cpn);
  url.searchParams.set("cmt", "0");
  // Without it YouTube may file the play under Shorts.
  url.searchParams.set("el", "detailpage");
  return url.toString();
}

/** Half of a short video, capped at HISTORY_MIN_WATCH_SEC; the cap alone
 *  while the duration is still unknown (0). */
export function historyThresholdSec(durationSec: number): number {
  if (!(durationSec > 0)) return HISTORY_MIN_WATCH_SEC;
  return Math.min(HISTORY_MIN_WATCH_SEC, durationSec / 2);
}

export interface WatchCredit {
  watchedSec: number;
  lastPositionSec: number;
  lastAt: number;
}

export interface WatchSample {
  positionSec: number;
  /** Wall clock, ms. */
  at: number;
}

/** Fold one player sample into the seconds actually watched. Only forward
 *  movement the wall clock can account for counts: seeks (either way) and a
 *  paused player add nothing. The gap between samples may be long — a
 *  background tab throttles the polling — and still counts if playback kept
 *  pace. Returns the same object for an unusable sample. */
export function creditWatch(credit: WatchCredit | undefined, sample: WatchSample): WatchCredit {
  if (!Number.isFinite(sample.positionSec) || sample.positionSec < 0) {
    return credit ?? { watchedSec: 0, lastPositionSec: 0, lastAt: sample.at };
  }
  if (!credit) return { watchedSec: 0, lastPositionSec: sample.positionSec, lastAt: sample.at };
  const advanced = sample.positionSec - credit.lastPositionSec;
  const elapsed = (sample.at - credit.lastAt) / 1000;
  const played = advanced > 0 && advanced <= elapsed * MAX_PLAYBACK_RATE + CREDIT_SLACK_SEC;
  return {
    watchedSec: credit.watchedSec + (played ? advanced : 0),
    lastPositionSec: sample.positionSec,
    lastAt: sample.at,
  };
}
