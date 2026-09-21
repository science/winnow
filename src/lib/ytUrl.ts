// YouTube answers a phone's user agent with a redirect to m.youtube.com,
// whose pages carry no `var ytInitialData` blob at all (measured 2026-09-18,
// Firefox for Android UA). `app=desktop` makes it serve the ordinary desktop
// page instead. It is a no-op for a desktop user agent and sets no preference
// cookie, so every page fetch carries it unconditionally — one code path.
//
// Never `persist_app=1`: that one does write a preference, and would switch
// the user's own mobile YouTube browsing to desktop mode.

const DESKTOP_PARAM = "app=desktop";

/** The same page, asked for in its desktop form. Appends textually so an
 *  already-encoded query is left byte-for-byte alone. */
export function desktopPageUrl(url: string): string {
  if (/[?&]app=desktop(&|#|$)/.test(url)) return url;
  const hashAt = url.indexOf("#");
  const base = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : url.slice(hashAt);
  return `${base}${base.includes("?") ? "&" : "?"}${DESKTOP_PARAM}${hash}`;
}

/** True when a fetch ended up on the mobile site despite the desktop ask. */
export function isMobileRedirect(finalUrl: string | undefined): boolean {
  if (!finalUrl) return false;
  try {
    return new URL(finalUrl).hostname === "m.youtube.com";
  } catch {
    return false;
  }
}
