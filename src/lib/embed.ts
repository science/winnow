// Embed URLs live here (not inline in Watch.svelte) so the unit tests can
// hold them in sync with the DNR Referer rule in public/dnr-rules.json —
// YouTube rejects referrer-less embed requests with player error 153, and
// extension pages never send a referrer without that rule.

export interface EmbedOptions {
  /** Resume point in seconds; 0/absent starts from the beginning. */
  startSec?: number;
  /** Ask the player to report its clock back over postMessage. */
  jsApi?: boolean;
  /** The page's OWN origin (`location.origin`). Required with jsApi. */
  origin?: string;
}

/** autoplay=1 = start-on-open: the video the user clicked plays immediately
 *  (unmuted — Firefox may still require an autoplay allow for the extension
 *  origin). Autoplay-NEXT stays forbidden: rel=0 limits end-screen
 *  suggestions and nothing ever queues after the video ends.
 *
 *  enablejsapi is listen-only: Winnow reads currentTime/duration to remember
 *  where you stopped, and never sends the player a command. It is paired with
 *  `origin` because the extension-tier gate measured that the player answers
 *  ONLY the page's own moz-extension:// origin — the DNR referer value and an
 *  omitted origin both produce total silence, so asking without a correct
 *  origin yields a player that looks wired up and reports nothing. */
export function embedUrl(videoId: string, opts: EmbedOptions = {}): string {
  let url = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`;
  const start = Math.floor(opts.startSec ?? 0);
  if (start > 0) url += `&start=${start}`;
  if (opts.jsApi && opts.origin) {
    url += `&enablejsapi=1&origin=${encodeURIComponent(opts.origin)}`;
  }
  return url;
}

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
