// The committed production-scale capture (126 videos around the gotham
// mis-ranking), gunzipped to a gitignored local copy on first use.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFeedPage } from "../src/services/youtube/feedParser";
import type { Video } from "../src/lib/types";

export function captureBundle(): any {
  const jsonPath = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "services", "youtube", "fixtures", "gotham-poor-ranking-capture.json");
  if (!existsSync(jsonPath)) writeFileSync(jsonPath, gunzipSync(readFileSync(`${jsonPath}.gz`)));
  return JSON.parse(readFileSync(jsonPath, "utf8"));
}

/** The capture's videos, home before subscriptions, deduplicated. */
export function captureVideos(): Video[] {
  const bundle = captureBundle();
  const all: Video[] = [];
  const seen = new Set<string>();
  for (const source of ["home", "subscriptions"] as const) {
    for (const v of parseFeedPage(bundle[source], source)) {
      if (!seen.has(v.id)) {
        seen.add(v.id);
        all.push(v);
      }
    }
  }
  return all;
}
