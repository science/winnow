import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { embedOrigin, embedRefererRules, embedUrl, EMBED_REFERER_RULE_ID, watchUrl } from "./embed";

// The embed player and the DNR Referer rule are one feature: YouTube rejects
// embed requests without an HTTP Referer (player error 153), and Firefox never
// sends a moz-extension:// referrer, so the extension must inject one via
// declarativeNetRequest. These tests lock the iframe URL, the manifest wiring,
// and the rule together so they can't drift apart.

interface DnrRule {
  id: number;
  action: {
    type: string;
    requestHeaders?: { header: string; operation: string; value?: string }[];
  };
  condition: { urlFilter?: string; regexFilter?: string; resourceTypes?: string[]; initiatorDomains?: string[] };
}

function readPublicJson<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../../public/${name}`, import.meta.url), "utf8")) as T;
}

interface Manifest {
  permissions: string[];
  host_permissions: string[];
  declarative_net_request?: { rule_resources: { id: string; enabled: boolean; path: string }[] };
}

describe("embedUrl", () => {
  it("should build a youtube-nocookie embed URL for the video id", () => {
    const url = embedUrl("abc123DEF45");
    expect(url).toContain("https://www.youtube-nocookie.com/embed/abc123DEF45");
  });

  it("should embed from youtube-nocookie.com unless the signed-in player is asked for", () => {
    expect(embedUrl("abc123DEF45", { signedIn: false })).toContain("https://www.youtube-nocookie.com/embed/");
  });

  it("should embed from youtube.com when the signed-in player is asked for", () => {
    // Only youtube.com/embed sees the account session: nocookie's own cookie
    // jar never holds a sign-in, so its plays are anonymous by construction.
    const url = embedUrl("abc123DEF45", { signedIn: true, startSec: 30, jsApi: true, origin: "moz-extension://x" });
    expect(url).toMatch(/^https:\/\/www\.youtube\.com\/embed\/abc123DEF45\?/);
    expect(url).toContain("autoplay=1");
    expect(url).toContain("start=30");
  });

  it("should report the origin each player posts its telemetry from", () => {
    expect(embedOrigin(false)).toBe("https://www.youtube-nocookie.com");
    expect(embedOrigin(true)).toBe("https://www.youtube.com");
    expect(new URL(embedUrl("x", { signedIn: true })).origin).toBe(embedOrigin(true));
    expect(new URL(embedUrl("x")).origin).toBe(embedOrigin(false));
  });

  it("should request start-on-open playback (the clicked video plays immediately)", () => {
    expect(embedUrl("abc123DEF45")).toContain("autoplay=1");
  });

  it("should never mute to smuggle playback past the browser's autoplay policy", () => {
    expect(embedUrl("abc123DEF45")).not.toContain("mute");
    expect(embedUrl("abc123DEF45", { startSec: 30, jsApi: true, origin: "moz-extension://x" })).not.toContain("mute");
  });

  it("should append a start offset when resuming", () => {
    expect(embedUrl("abc123DEF45", { startSec: 754 })).toContain("start=754");
  });

  it("should round a fractional resume offset to a whole second", () => {
    expect(embedUrl("abc123DEF45", { startSec: 754.83 })).toContain("start=754");
  });

  it("should omit start when there is nothing to resume", () => {
    expect(embedUrl("abc123DEF45")).not.toContain("start=");
    expect(embedUrl("abc123DEF45", { startSec: 0 })).not.toContain("start=");
  });

  it("should request the player JS API with the page's own origin", () => {
    // The extension-tier gate proved this is the ONLY origin the player
    // answers: the DNR referer value and an omitted origin both get silence.
    const url = embedUrl("abc123DEF45", { jsApi: true, origin: "moz-extension://abcd-1234" });
    expect(url).toContain("enablejsapi=1");
    expect(url).toContain(`origin=${encodeURIComponent("moz-extension://abcd-1234")}`);
  });

  it("should not enable the JS API without an origin to hand it", () => {
    // enablejsapi with a wrong/absent origin yields a player that never
    // reports — worse than not asking, because it looks wired up.
    expect(embedUrl("abc123DEF45", { jsApi: true })).not.toContain("enablejsapi");
  });
});

describe("watchUrl", () => {
  it("should build a plain youtube.com watch URL", () => {
    expect(watchUrl("abc123DEF45")).toBe("https://www.youtube.com/watch?v=abc123DEF45");
  });
});

describe("embed Referer rule (YouTube error 153 guard)", () => {
  const manifest = readPublicJson<Manifest>("manifest.json");
  const EXT_HOST = "d3adbeef-0000-4000-8000-000000000001";
  const rules = embedRefererRules(EXT_HOST);

  function refererOf(rule: DnrRule): string | undefined {
    return rule.action.requestHeaders?.find((h) => h.header.toLowerCase() === "referer")?.value;
  }

  it("should hold the DNR-with-host-access permission and both embed-host permissions", () => {
    expect(manifest.permissions).toContain("declarativeNetRequestWithHostAccess");
    expect(manifest.host_permissions.some((h) => h.includes("youtube-nocookie.com"))).toBe(true);
    expect(manifest.host_permissions.some((h) => h.includes("youtube.com"))).toBe(true);
  });

  it("should set an https Referer on embed sub_frame requests", () => {
    expect(rules).toHaveLength(1);
    const rule = rules[0]!;
    expect(rule.id).toBe(EMBED_REFERER_RULE_ID);
    expect(rule.action.type).toBe("modifyHeaders");
    const header = rule.action.requestHeaders!.find((h) => h.header.toLowerCase() === "referer")!;
    expect(header.operation).toBe("set");
    expect(header.value).toMatch(/^https:\/\//);
    expect(rule.condition.resourceTypes).toEqual(["sub_frame"]);
  });

  it("should only rewrite embeds that Winnow's own pages load", () => {
    // Measured 2026-09-16 in real Firefox 155: an unscoped rule also rewrote
    // the Referer of embeds on ordinary websites, breaking their attribution
    // and any embed restricted to its own domain.
    expect(rules[0]!.condition.initiatorDomains).toEqual([EXT_HOST]);
  });

  it("should not claim youtube.com as the referer (YouTube rejects its own domain: error 152)", () => {
    expect(new URL(refererOf(rules[0]!)!).hostname).not.toMatch(/(^|\.)youtube\.com$/);
  });

  it("should match the exact URLs both players embed, and nothing else", () => {
    const re = new RegExp(rules[0]!.condition.regexFilter!);
    for (const signedIn of [false, true]) {
      expect(re.test(embedUrl("abc123DEF45", { signedIn }))).toBe(true);
      expect(
        re.test(embedUrl("abc123DEF45", { signedIn, startSec: 754, jsApi: true, origin: "moz-extension://abcd-1234" })),
      ).toBe(true);
    }
    expect(re.test("https://www.youtube.com/watch?v=abc123DEF45")).toBe(false);
    expect(re.test("https://evil.example/https://www.youtube.com/embed/x")).toBe(false);
  });

  it("should keep every Referer rewrite out of the static ruleset", () => {
    // Static rules can't name the per-install moz-extension host, so a static
    // Referer rule would apply to every site the user browses.
    for (const resource of manifest.declarative_net_request?.rule_resources ?? []) {
      for (const rule of readPublicJson<DnrRule[]>(resource.path)) {
        expect(refererOf(rule)).toBeUndefined();
      }
    }
  });
});
