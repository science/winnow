import { describe, it, expect } from "vitest";
import { extractYtInitialData, extractLoggedIn } from "./ytPage";

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

describe("extractLoggedIn", () => {
  it("should detect logged-in state from ytcfg", () => {
    expect(extractLoggedIn(SAMPLE_HTML)).toBe(true);
    expect(extractLoggedIn(SIGNED_OUT_HTML)).toBe(false);
  });

  it("should return null when the flag is absent", () => {
    expect(extractLoggedIn("<html></html>")).toBeNull();
  });
});
