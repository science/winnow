// ?demo=1: fixture feed, stub scorer, zero network — and, inside the
// installed extension, zero contact with the user's real stored data.

export function isDemoMode(): boolean {
  return typeof location !== "undefined" && new URLSearchParams(location.search).has("demo");
}
