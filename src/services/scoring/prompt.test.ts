import { describe, expect, it } from "vitest";
import { buildUserMessage } from "./prompt";
import type { FeedbackExample } from "../../lib/feedback";
import type { Profile, Video } from "../../lib/types";

const profile: Profile = { moreOf: "science", lessOf: "drama", updatedAt: 0 };

function video(id: string): Video {
  return {
    id,
    source: "subscriptions",
    title: `Video ${id}`,
    channelTitle: "c",
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
  };
}

const EXAMPLES: FeedbackExample[] = [
  { vote: "down", title: "Shocking Drama Exposed", channel: "Drama Central", duration: "8:01" },
  { vote: "up", title: "A Careful Deep Dive", channel: "Slow TV", duration: "1:30:00" },
];

describe("buildUserMessage feedback section", () => {
  it("should append a feedback section listing recent votes", () => {
    const msg = buildUserMessage([video("vid00000001")], profile, EXAMPLES);
    expect(msg).toContain("<feedback>");
    expect(msg).toContain("</feedback>");
    expect(msg).toContain("Shocking Drama Exposed");
    expect(msg).toContain("A Careful Deep Dive");
    expect(msg).toContain('"vote": "down"');
  });

  it("should omit the feedback section when no votes exist", () => {
    expect(buildUserMessage([video("vid00000001")], profile)).not.toContain("<feedback>");
    expect(buildUserMessage([video("vid00000001")], profile, [])).not.toContain("<feedback>");
  });

  it("should keep the items block unchanged when feedback is present", () => {
    const bare = buildUserMessage([video("vid00000001")], profile);
    const withFeedback = buildUserMessage([video("vid00000001")], profile, EXAMPLES);
    const itemsOf = (msg: string): string => msg.slice(msg.indexOf("Score these"));
    expect(itemsOf(withFeedback)).toBe(itemsOf(bare));
  });

  it("should place the feedback section between the profile and the items", () => {
    const msg = buildUserMessage([video("vid00000001")], profile, EXAMPLES);
    expect(msg.indexOf("</profile>")).toBeLessThan(msg.indexOf("<feedback>"));
    expect(msg.indexOf("</feedback>")).toBeLessThan(msg.indexOf("Score these"));
  });
});
