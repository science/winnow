import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// AMO permanently rejects re-signing a version it has already seen, and
// nothing in the build syncs the two version fields — the zip filename comes
// from package.json while Firefox installs whatever public/manifest.json says.
// Locking them together makes "bump the version before tagging" one edit that
// can't half-happen.

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8")) as T;
}

describe("release versioning", () => {
  it("should keep public/manifest.json and package.json versions in sync for AMO signing", () => {
    const manifest = readJson<{ version: string }>("../../public/manifest.json");
    const pkg = readJson<{ version: string }>("../../package.json");
    expect(manifest.version).toBe(pkg.version);
  });
});
