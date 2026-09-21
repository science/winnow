import { afterEach, describe, it, expect, vi } from "vitest";

// background.ts is import-free with a top-level listener registration, so it
// is loaded fresh per test against a stubbed `browser` global.
// It must also stay a classic script (no import/export) for the manifest's
// background.scripts, so TypeScript can't see it as a module: the specifier
// goes through a variable.
type Listener = () => void;
const BACKGROUND = "./background";

function stubBrowser(opts: { existingTab?: { id: number; windowId?: number }; withWindows: boolean }) {
  let listener: Listener | undefined;
  const tabs = {
    query: vi.fn(async () => (opts.existingTab ? [opts.existingTab] : [])),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
  };
  const windows = { update: vi.fn(async () => ({})) };
  vi.stubGlobal("browser", {
    action: { onClicked: { addListener: (cb: Listener) => (listener = cb) } },
    runtime: { getURL: (path: string) => `moz-extension://uuid/${path}` },
    tabs,
    ...(opts.withWindows ? { windows } : {}),
  });
  return { tabs, windows, click: () => listener!() };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("toolbar button", () => {
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown): void => void rejections.push(reason);

  afterEach(() => {
    process.off("unhandledRejection", onRejection);
    rejections.length = 0;
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("should open the feed when no feed tab exists", async () => {
    const b = stubBrowser({ withWindows: true });
    await import(/* @vite-ignore */ BACKGROUND);
    b.click();
    await settle();
    expect(b.tabs.create).toHaveBeenCalledWith({ url: "moz-extension://uuid/feed.html" });
  });

  it("should focus the existing feed tab and its window", async () => {
    const b = stubBrowser({ existingTab: { id: 7, windowId: 3 }, withWindows: true });
    await import(/* @vite-ignore */ BACKGROUND);
    b.click();
    await settle();
    expect(b.tabs.update).toHaveBeenCalledWith(7, { active: true });
    expect(b.windows.update).toHaveBeenCalledWith(3, { focused: true });
    expect(b.tabs.create).not.toHaveBeenCalled();
  });

  it("should focus the existing feed tab where there is no windows API", async () => {
    // Firefox for Android implements no browser.windows at all.
    process.on("unhandledRejection", onRejection);
    const b = stubBrowser({ existingTab: { id: 7, windowId: 3 }, withWindows: false });
    await import(/* @vite-ignore */ BACKGROUND);
    b.click();
    await settle();
    await new Promise((r) => setTimeout(r, 0));
    expect(b.tabs.update).toHaveBeenCalledWith(7, { active: true });
    expect(rejections).toEqual([]);
  });
});
