// Embed URLs live here (not inline in Watch.svelte) so the unit tests can
// hold them in sync with the DNR Referer rule in public/dnr-rules.json —
// YouTube rejects referrer-less embed requests with player error 153, and
// extension pages never send a referrer without that rule.

/** autoplay=1 = start-on-open: the video the user clicked plays immediately
 *  (unmuted — Firefox may still require an autoplay allow for the extension
 *  origin). Autoplay-NEXT stays forbidden: rel=0 limits end-screen
 *  suggestions and nothing ever queues after the video ends. */
export function embedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`;
}

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
