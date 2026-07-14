import { readable } from "svelte/store";

export type Route =
  | { name: "feed" }
  | { name: "watch"; videoId: string }
  | { name: "settings" };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, "");
  const watchMatch = /^watch\/([A-Za-z0-9_-]+)$/.exec(path);
  if (watchMatch?.[1]) return { name: "watch", videoId: watchMatch[1] };
  if (path === "settings") return { name: "settings" };
  return { name: "feed" };
}

// Guarded so pure logic in this module stays importable from node tests.
const hasDom = typeof window !== "undefined";

export const route = readable<Route>(parseHash(hasDom ? location.hash : ""), (set) => {
  if (!hasDom) return;
  const onChange = (): void => set(parseHash(location.hash));
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
});

export function navigate(to: Route): void {
  switch (to.name) {
    case "feed":
      location.hash = "#/";
      break;
    case "watch":
      location.hash = `#/watch/${to.videoId}`;
      break;
    case "settings":
      location.hash = "#/settings";
      break;
  }
}
