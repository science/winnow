import { describe, it, expect } from "vitest";
import type { Video } from "../../lib/types";
import {
  buildEnrichMessage,
  DIGESTS_SCHEMA,
  ENRICH_TRANSCRIPT_CHARS,
  ENRICH_SYSTEM_PROMPT,
} from "./enrichPrompt";
import { buildTranslateMessage, TARGET_SCHEMA, TRANSLATE_SYSTEM_PROMPT } from "./translatePrompt";
import { DIGEST_NUMERIC_FIELDS } from "../../lib/types";

const video = (id: string): Video => ({
  id,
  source: "home",
  title: `Video ${id}`,
  channelTitle: "Chan",
  channelId: null,
  durationText: "10:00",
  durationSec: 600,
  publishedText: "1 day ago",
  publishedAtApprox: null,
  viewCountText: "1K views",
  viewCount: 1000,
  thumbnailUrl: null,
  descriptionSnippet: null,
  isLive: false,
});

describe("buildEnrichMessage", () => {
  it("should include the transcript when present and omit the key when absent", () => {
    const msg = buildEnrichMessage([
      { video: video("withtrans01"), transcript: "spoken words here" },
      { video: video("notrans0001"), transcript: null },
    ]);
    const items = JSON.parse(msg.replace(/<\/?videos>/g, "")) as Array<Record<string, unknown>>;
    expect(items[0]!["transcript"]).toBe("spoken words here");
    expect(items[1]!["transcript"]).toBeUndefined();
  });

  it("should cap the transcript at the enrichment budget", () => {
    const msg = buildEnrichMessage([
      { video: video("longtrans01"), transcript: "x".repeat(ENRICH_TRANSCRIPT_CHARS + 5000) },
    ]);
    const items = JSON.parse(msg.replace(/<\/?videos>/g, "")) as Array<{ transcript: string }>;
    expect(items[0]!.transcript.length).toBe(ENRICH_TRANSCRIPT_CHARS);
  });
});

describe("schemas stay strict and aligned with the taxonomy", () => {
  it("should require every numeric digest axis in the digest item schema", () => {
    const item = DIGESTS_SCHEMA.properties.digests.items;
    for (const field of DIGEST_NUMERIC_FIELDS) {
      expect(item.required).toContain(field);
      expect(item.properties[field]).toEqual({ type: "integer" });
    }
    expect(item.additionalProperties).toBe(false);
  });

  it("should make every target field nullable (strict-schema optionality workaround)", () => {
    for (const field of DIGEST_NUMERIC_FIELDS) {
      expect(TARGET_SCHEMA.properties.fields.properties[field].type).toEqual(["object", "null"]);
    }
    expect(TARGET_SCHEMA.properties.topicsMore.type).toEqual(["object", "null"]);
  });

  it("should describe the BS axis in both prompts", () => {
    expect(ENRICH_SYSTEM_PROMPT).toContain("claimOverreach");
    expect(ENRICH_SYSTEM_PROMPT).toContain("provocateur");
    expect(TRANSLATE_SYSTEM_PROMPT).toContain("claimOverreach");
  });
});

describe("buildTranslateMessage", () => {
  it("should carry profile text and include votes only when present", () => {
    const profile = { moreOf: "deep chess analysis", lessOf: "drama", updatedAt: 0 };
    const bare = buildTranslateMessage(profile);
    expect(bare).toContain("deep chess analysis");
    expect(bare).not.toContain("<votes>");
    const withVotes = buildTranslateMessage(profile, [
      { vote: "down", title: "SHOCKING physics", channel: "Prov", duration: "12:00" },
    ]);
    expect(withVotes).toContain("<votes>");
    expect(withVotes).toContain("SHOCKING physics");
  });
});
