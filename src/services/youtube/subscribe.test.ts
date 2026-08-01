import { describe, it, expect, vi } from "vitest";
import { subscribeToChannel, subConfirmationUrl, SUBSCRIBE_PARAMS } from "./subscribe";

const CONFIG = { apiKey: "test-key", clientVersion: "2.20260731.00.00" };

function okResponse(body: unknown = { actions: [{ openPopupAction: {} }] }) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function deps(over: Record<string, unknown> = {}) {
  return {
    fetchFn: vi.fn(async () => okResponse()) as unknown as typeof fetch,
    getSapisidFn: async () => "test-sapisid-value",
    getConfigFn: async () => CONFIG,
    now: () => 1700000000000,
    ...over,
  };
}

describe("subscribeToChannel", () => {
  it("should sign the subscribe call with SAPISIDHASH and claim the youtube.com origin", async () => {
    const d = deps();
    const outcome = await subscribeToChannel("UCtestchannel01", d);

    expect(outcome).toEqual({ subscribed: true });
    const [url, init] = (d.fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toContain("/youtubei/v1/subscription/subscribe");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["Authorization"]).toMatch(/^SAPISIDHASH \d+_[0-9a-f]{40}$/);
    expect(headers["X-Origin"]).toBe("https://www.youtube.com");
    expect(headers["X-Goog-AuthUser"]).toBe("0");
    expect((init as RequestInit).credentials).toBe("include");
  });

  it("should send the channel id and subscribe params in an InnerTube WEB-client body", async () => {
    const d = deps();
    await subscribeToChannel("UCtestchannel01", d);

    const [, init] = (d.fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.channelIds).toEqual(["UCtestchannel01"]);
    expect(body.params).toBe(SUBSCRIBE_PARAMS);
    expect(body.context.client.clientName).toBe("WEB");
    expect(body.context.client.clientVersion).toBe(CONFIG.clientVersion);
  });

  it("should return a failure marker when no SAPISID is readable", async () => {
    const d = deps({ getSapisidFn: async () => null });
    expect(await subscribeToChannel("UCtestchannel01", d)).toEqual({ failure: "no-sapisid" });
    expect(d.fetchFn).not.toHaveBeenCalled();
  });

  it("should return a failure marker when the InnerTube config is unavailable", async () => {
    const d = deps({ getConfigFn: async () => null });
    expect(await subscribeToChannel("UCtestchannel01", d)).toEqual({
      failure: "no-innertube-config",
    });
    expect(d.fetchFn).not.toHaveBeenCalled();
  });

  it("should report the status on an HTTP failure and never retry a 4xx", async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 403 }) as unknown as Response);
    const outcome = await subscribeToChannel("UCtestchannel01", deps({ fetchFn }));
    expect(outcome).toEqual({ failure: "http-403" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("should return a network failure marker instead of throwing", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("NetworkError");
    }) as unknown as typeof fetch;
    expect(await subscribeToChannel("UCtestchannel01", deps({ fetchFn }))).toEqual({
      failure: "network",
    });
  });

  it("should reject a channel id that is not a channel", async () => {
    const d = deps();
    expect(await subscribeToChannel("", d)).toEqual({ failure: "no-channel-id" });
    expect(d.fetchFn).not.toHaveBeenCalled();
  });
});

describe("subConfirmationUrl — the fallback when the signed write fails", () => {
  it("should build YouTube's own subscribe-confirmation URL for a channel", () => {
    expect(subConfirmationUrl("UCtestchannel01")).toBe(
      "https://www.youtube.com/channel/UCtestchannel01?sub_confirmation=1",
    );
  });
});

describe("subscribe manifest wiring", () => {
  it("should hold the cookies permission the SAPISID read requires", async () => {
    const { readFileSync } = await import("node:fs");
    const manifest = JSON.parse(
      readFileSync(new URL("../../../public/manifest.json", import.meta.url), "utf8"),
    ) as { permissions: string[]; host_permissions: string[] };
    expect(manifest.permissions).toContain("cookies");
    expect(manifest.host_permissions.some((h) => h.includes("youtube.com"))).toBe(true);
  });

  it("should reach the subscribe endpoint through the existing DNR Origin rule", async () => {
    const { readFileSync } = await import("node:fs");
    const rules = JSON.parse(
      readFileSync(new URL("../../../public/dnr-rules.json", import.meta.url), "utf8"),
    ) as { condition: { urlFilter: string }; action: { requestHeaders?: { header: string }[] } }[];
    // The subscribe POST is bot-blocked from a moz-extension:// origin. Rule 2's
    // path-prefix filter already covers it — no new rule, no widened surface.
    const originRule = rules.find((r) =>
      r.action.requestHeaders?.some((h) => h.header === "Origin"),
    );
    expect(originRule).toBeDefined();
    expect(SUBSCRIBE_URL_FOR_TEST.startsWith("https://www.youtube.com/youtubei/")).toBe(true);
    expect(originRule!.condition.urlFilter).toBe("||www.youtube.com/youtubei/");
  });
});

const SUBSCRIBE_URL_FOR_TEST = "https://www.youtube.com/youtubei/v1/subscription/subscribe";
