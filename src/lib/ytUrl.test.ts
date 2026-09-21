import { describe, it, expect } from "vitest";
import { desktopPageUrl, isMobileRedirect } from "./ytUrl";

describe("desktopPageUrl", () => {
  it("should ask for the desktop page on a URL without a query", () => {
    expect(desktopPageUrl("https://www.youtube.com/feed/subscriptions")).toBe(
      "https://www.youtube.com/feed/subscriptions?app=desktop",
    );
    expect(desktopPageUrl("https://www.youtube.com/")).toBe("https://www.youtube.com/?app=desktop");
  });

  it("should append to an existing query without re-encoding it", () => {
    expect(desktopPageUrl("https://www.youtube.com/results?search_query=kpop%20stage%20mix%20%26%20more")).toBe(
      "https://www.youtube.com/results?search_query=kpop%20stage%20mix%20%26%20more&app=desktop",
    );
    expect(desktopPageUrl("https://www.youtube.com/watch?v=vid12345678")).toBe(
      "https://www.youtube.com/watch?v=vid12345678&app=desktop",
    );
  });

  it("should be idempotent", () => {
    const once = desktopPageUrl("https://www.youtube.com/watch?v=vid12345678");
    expect(desktopPageUrl(once)).toBe(once);
  });

  it("should never ask YouTube to persist the choice", () => {
    // persist_app=1 would switch the user's own mobile browsing to desktop mode.
    expect(desktopPageUrl("https://www.youtube.com/")).not.toContain("persist_app");
  });
});

describe("isMobileRedirect", () => {
  it("should recognize a response that ended up on the mobile site", () => {
    expect(isMobileRedirect("https://m.youtube.com/feed/subscriptions")).toBe(true);
  });

  it("should accept the desktop site and tolerate missing or junk URLs", () => {
    expect(isMobileRedirect("https://www.youtube.com/feed/subscriptions?app=desktop")).toBe(false);
    expect(isMobileRedirect("")).toBe(false);
    expect(isMobileRedirect(undefined)).toBe(false);
    expect(isMobileRedirect("not a url")).toBe(false);
  });
});
