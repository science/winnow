import { describe, expect, it } from "vitest";
import { sapisidHashHeader, YOUTUBE_ORIGIN } from "./sapisidHash";

describe("sapisidHashHeader", () => {
  it("should build the exact SAPISIDHASH header for a known vector", async () => {
    // Vector precomputed with node:crypto:
    // sha1("1700000000 test-sapisid-value https://www.youtube.com")
    const header = await sapisidHashHeader("test-sapisid-value", YOUTUBE_ORIGIN, () => 1700000000000);
    expect(header).toBe("SAPISIDHASH 1700000000_5820a5e69f4feb3f2d6e421470411e3ece1dad14");
  });

  it("should use whole seconds, not milliseconds", async () => {
    const header = await sapisidHashHeader("s", YOUTUBE_ORIGIN, () => 1700000000999);
    expect(header).toMatch(/^SAPISIDHASH 1700000000_[0-9a-f]{40}$/);
  });
});
