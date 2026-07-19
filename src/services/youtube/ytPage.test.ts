import { afterEach, describe, it, expect, vi } from "vitest";
import {
  extractYtInitialData,
  extractInnertubeConfig,
  extractLoggedIn,
  fetchSearchPage,
  lastCaptures,
} from "./ytPage";

const SAMPLE_HTML = `<!doctype html><html><head>
<script>ytcfg.set({"INNERTUBE_API_KEY":"AIzaXXX","LOGGED_IN":true,"OTHER":1});</script>
</head><body>
<script nonce="abc">var ytInitialData = {"contents":{"foo":[1,2,{"bar":"a};b"}]}};</script>
</body></html>`;

const SIGNED_OUT_HTML = `<html><script>ytcfg.set({"LOGGED_IN":false});</script>
<script>var ytInitialData = {"contents":{}};</script></html>`;

describe("extractYtInitialData", () => {
  it("should extract and parse the ytInitialData JSON blob", () => {
    const data = extractYtInitialData(SAMPLE_HTML) as Record<string, unknown>;
    expect(data).toBeTruthy();
    expect(data["contents"]).toEqual({ foo: [1, 2, { bar: "a};b" }] });
  });

  it("should return null when the blob is absent", () => {
    expect(extractYtInitialData("<html>consent wall</html>")).toBeNull();
  });

  it("should return null for malformed JSON instead of throwing", () => {
    expect(extractYtInitialData('var ytInitialData = {"unterminated;</script>')).toBeNull();
  });
});

describe("extractInnertubeConfig", () => {
  it("should extract INNERTUBE_API_KEY and client version from ytcfg", () => {
    const html = `<script>ytcfg.set({"INNERTUBE_API_KEY":"AIzaTest123","INNERTUBE_CONTEXT_CLIENT_VERSION":"2.20260101.00.00","LOGGED_IN":true});</script>`;
    expect(extractInnertubeConfig(html)).toEqual({
      apiKey: "AIzaTest123",
      clientVersion: "2.20260101.00.00",
    });
  });

  it("should return null when ytcfg is absent or incomplete", () => {
    expect(extractInnertubeConfig("<html></html>")).toBeNull();
    expect(extractInnertubeConfig(`<script>ytcfg.set({"INNERTUBE_API_KEY":"AIzaTest123"});</script>`)).toBeNull();
  });
});

describe("fetchSearchPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(html: string): ReturnType<typeof vi.fn> {
    const mock = vi.fn(async () => ({ ok: true, status: 200, text: async () => html }));
    vi.stubGlobal("fetch", mock);
    return mock;
  }

  it("should URL-encode the query into the results URL and carry credentials", async () => {
    const mock = stubFetch(SAMPLE_HTML);
    await fetchSearchPage("kpop stage mix & more");
    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = mock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://www.youtube.com/results?search_query=kpop%20stage%20mix%20%26%20more",
    );
    expect(init.credentials).toBe("include");
  });

  it("should not treat a signed-out search page as fatal", async () => {
    // Search works without a session; SignedOutError is reserved for feeds.
    stubFetch(SIGNED_OUT_HTML);
    const page = await fetchSearchPage("woodworking");
    expect(page.loggedIn).toBe(false);
    expect(page.data).toEqual({ contents: {} });
  });

  it("should record the raw capture for the debug-fixture flow", async () => {
    stubFetch(SAMPLE_HTML);
    await fetchSearchPage("anything");
    expect(lastCaptures["search"]).toContain('"contents"');
  });
});

describe("extractLoggedIn", () => {
  it("should detect logged-in state from ytcfg", () => {
    expect(extractLoggedIn(SAMPLE_HTML)).toBe(true);
    expect(extractLoggedIn(SIGNED_OUT_HTML)).toBe(false);
  });

  it("should return null when the flag is absent", () => {
    expect(extractLoggedIn("<html></html>")).toBeNull();
  });
});
