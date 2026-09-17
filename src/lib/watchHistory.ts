// The watch-history ping, as yt-dlp's `_mark_watched` sends it. Embedded
// players report plays as `el=embedded`, which YouTube does not record to
// watch history (measured 2026-09-16 with the signed-in player); a watch
// page's own playback ping does. Measured the same day: the playback ping
// alone at cmt=0 records the entry, so Winnow never claims a watchtime the
// user didn't spend.

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
