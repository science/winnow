// Embed URLs live here (not inline in Watch.svelte) so the unit tests can
// hold them in sync with the DNR Referer rule in public/dnr-rules.json —
// YouTube rejects referrer-less embed requests with player error 153, and
// extension pages never send a referrer without that rule.

/** youtube-nocookie + no autoplay: nothing plays until the user presses play.
 *  rel=0 limits end-screen suggestions to the same channel. */
export function embedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1`;
}

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
