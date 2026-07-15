// Hygiene gate for the committed production-scale capture fixture: it must
// stay free of session/account identifiers (it started life as a signed-in
// capture) and must keep parsing into the real feed — it exists to
// reproduce ranking bugs against a full 126-video feed.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { scanSuspectKeys } from "../../lib/captureScrub";
import { parseFeedPage } from "./feedParser";

const here = dirname(fileURLToPath(import.meta.url));
const bundle = JSON.parse(
  gunzipSync(readFileSync(join(here, "fixtures", "gotham-poor-ranking-capture.json.gz"))).toString("utf8"),
);

describe("gotham capture fixture", () => {
  it("should contain no residual session/account identifier keys", () => {
    expect(scanSuspectKeys(bundle)).toEqual([]);
  });

  it("should still parse into a production-scale feed including the mis-ranked video", () => {
    const home = parseFeedPage(bundle.home, "home");
    const subs = parseFeedPage(bundle.subscriptions, "subscriptions");
    expect(home.length).toBeGreaterThan(10);
    expect(subs.length).toBeGreaterThan(10);
    const ids = new Set([...home, ...subs].map((v) => v.id));
    expect(ids.has("PEopqMY5WCQ")).toBe(true);
  });

  it("should carry the captured translated target for ranker repro tests", () => {
    expect(bundle.scoring.target.target.topicsLess.items).toContain("comic chess");
    expect(bundle.scoring.target.target.topicsMore.items).toContain("top tier play");
  });
});
