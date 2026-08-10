import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { embedUrl, watchUrl } from "./embed";

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
  condition: { urlFilter?: string; resourceTypes?: string[] };
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

  it("should register an enabled static DNR ruleset in the manifest", () => {
    const resources = manifest.declarative_net_request?.rule_resources ?? [];
    expect(resources.length).toBeGreaterThan(0);
    expect(resources.every((r) => r.enabled)).toBe(true);
  });

  it("should hold the DNR-with-host-access permission and embed-host permission", () => {
    expect(manifest.permissions).toContain("declarativeNetRequestWithHostAccess");
    expect(manifest.host_permissions.some((h) => h.includes("youtube-nocookie.com"))).toBe(true);
  });

  it("should set an https Referer on embed sub_frame requests", () => {
    const path = manifest.declarative_net_request!.rule_resources[0]!.path;
    const rules = readPublicJson<DnrRule[]>(path);
    const rule = rules.find((r) =>
      r.action.requestHeaders?.some((h) => h.header.toLowerCase() === "referer"),
    );
    expect(rule).toBeDefined();
    expect(rule!.action.type).toBe("modifyHeaders");
    const referer = rule!.action.requestHeaders!.find((h) => h.header.toLowerCase() === "referer")!;
    expect(referer.operation).toBe("set");
    expect(referer.value).toMatch(/^https:\/\//);
    expect(rule!.condition.resourceTypes).toContain("sub_frame");
  });

  it("should not claim youtube.com as the referer (YouTube rejects its own domain: error 152)", () => {
    const path = manifest.declarative_net_request!.rule_resources[0]!.path;
    const rules = readPublicJson<DnrRule[]>(path);
    for (const rule of rules) {
      for (const h of rule.action.requestHeaders ?? []) {
        if (h.header.toLowerCase() !== "referer") continue;
        expect(new URL(h.value!).hostname).not.toMatch(/(^|\.)youtube\.com$/);
      }
    }
  });

  it("should match the exact URL the inline player embeds", () => {
    const path = manifest.declarative_net_request!.rule_resources[0]!.path;
    const rules = readPublicJson<DnrRule[]>(path);
    const filter = rules[0]!.condition.urlFilter!;
    // ||host/path matches any-scheme, any-subdomain-anchored URLs; the plain
    // substring must appear in the real embed URL or the rule is dead weight.
    expect(embedUrl("abc123DEF45")).toContain(filter.replace(/^\|\|/, ""));
    // ...including the fully-optioned URL the player actually uses.
    expect(
      embedUrl("abc123DEF45", { startSec: 754, jsApi: true, origin: "moz-extension://abcd-1234" }),
    ).toContain(filter.replace(/^\|\|/, ""));
  });
});
