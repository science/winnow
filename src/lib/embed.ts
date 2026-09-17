// Embed URLs live here (not inline in the player) so the unit tests can hold
// them in sync with the DNR Referer rule built below — YouTube rejects
// referrer-less embed requests with player error 153, and extension pages
// never send a referrer without that rule.

const ANONYMOUS_ORIGIN = "https://www.youtube-nocookie.com";
/** In an extension page holding the youtube.com host permission, Firefox
 * treats the embed frame as top-level, so its cookies are the account's own
 * unpartitioned session (measured 2026-09-16, Firefox 155). */
const SIGNED_IN_ORIGIN = "https://www.youtube.com";

export interface EmbedOptions {
  /** Resume point in seconds; 0/absent starts from the beginning. */
  startSec?: number;
  /** Ask the player to report its clock back over postMessage. */
  jsApi?: boolean;
  /** The page's OWN origin (`location.origin`). Required with jsApi. */
  origin?: string;
  /** Load the youtube.com player, which plays as the signed-in account (its
   *  plays reach watch history). Otherwise the privacy-enhanced player. */
  signedIn?: boolean;
}

/** The origin a player's page — and therefore its postMessage telemetry —
 *  comes from. */
export function embedOrigin(signedIn: boolean): string {
  return signedIn ? SIGNED_IN_ORIGIN : ANONYMOUS_ORIGIN;
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
  let url = `${embedOrigin(opts.signedIn ?? false)}/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`;
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

export const EMBED_REFERER_RULE_ID = 1001;

export interface DnrModifyHeadersRule {
  id: number;
  priority: number;
  action: {
    type: "modifyHeaders";
    requestHeaders: { header: string; operation: "set"; value: string }[];
  };
  condition: { regexFilter: string; resourceTypes: "sub_frame"[]; initiatorDomains: string[] };
}

/** The Referer rewrite for both players, scoped to frames Winnow's own pages
 *  load. It has to be registered at runtime: the scope is this install's
 *  moz-extension host, which a static ruleset can't name — and an unscoped
 *  rule rewrites the Referer of embeds on every site the user browses.
 *
 *  www.youtube.com is the second initiator because once youtube.com has
 *  installed its service worker, Firefox re-issues the signed-in player's
 *  navigation with youtube.com as its initiator (measured 2026-09-16; a
 *  tabIds-scoped rule doesn't match the re-issued request either). Embeds on
 *  other sites keep their own initiator, so they stay untouched.
 *
 *  Never a youtube.com referer: YouTube rejects its own domain (error 152). */
export function embedRefererRules(extensionHost: string): DnrModifyHeadersRule[] {
  return [
    {
      id: EMBED_REFERER_RULE_ID,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ header: "Referer", operation: "set", value: "https://winnow.misuse.org/" }],
      },
      condition: {
        regexFilter: "^https://www\\.youtube(-nocookie)?\\.com/embed/",
        resourceTypes: ["sub_frame"],
        initiatorDomains: [extensionHost, "www.youtube.com"],
      },
    },
  ];
}
