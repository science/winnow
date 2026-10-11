import { describe, it, expect } from "vitest";

// The free tier must never reach the network: a stray live call here once
// meant real YouTube traffic on every `npm test`, from the user's home IP.
describe("unit-tier network guard", () => {
  it("should reject any real fetch with an explanation", async () => {
    await expect(fetch("https://example.invalid/")).rejects.toThrow(/unit tests must not reach the network/);
  });
});
