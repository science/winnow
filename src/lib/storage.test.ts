import { afterEach, describe, expect, it, vi } from "vitest";
import { storageGet, storageRemove, storageSet } from "./storage";

// Demo mode runs on fixture data. Inside the installed extension it must
// never touch browser.storage.local: on 2026-09-16 opening ?demo=1 there
// replaced the user's cached feed with the fixtures, and the refresh that
// followed pruned their watched marks, resume points, and caches to match.

function fakeExtensionStorage() {
  const data: Record<string, unknown> = {};
  const local = {
    get: vi.fn(async (key: string) => (key in data ? { [key]: data[key] } : {})),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(data, items);
    }),
    remove: vi.fn(async (key: string) => {
      delete data[key];
    }),
  };
  vi.stubGlobal("browser", { storage: { local } });
  return { data, local };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("storage outside demo mode", () => {
  it("should persist to extension storage when it exists", async () => {
    const { data } = fakeExtensionStorage();
    vi.stubGlobal("location", { search: "" });
    await storageSet("winnow:test:v1", { a: 1 });
    expect(data["winnow:test:v1"]).toEqual({ a: 1 });
    expect(await storageGet("winnow:test:v1")).toEqual({ a: 1 });
  });
});

describe("storage in demo mode", () => {
  it("should never read, write, or remove extension storage", async () => {
    const { data, local } = fakeExtensionStorage();
    data["winnow:videos:v1"] = { real: true };
    vi.stubGlobal("location", { search: "?demo=1" });

    expect(await storageGet("winnow:videos:v1")).toBeNull();
    await storageSet("winnow:videos:v1", { demo: true });
    await storageRemove("winnow:videos:v1");

    expect(data["winnow:videos:v1"]).toEqual({ real: true });
    expect(local.get).not.toHaveBeenCalled();
    expect(local.set).not.toHaveBeenCalled();
    expect(local.remove).not.toHaveBeenCalled();
  });

  it("should still keep its own state across calls", async () => {
    fakeExtensionStorage();
    vi.stubGlobal("location", { search: "?demo=1" });
    await storageSet("winnow:demo-state:v1", { n: 2 });
    expect(await storageGet("winnow:demo-state:v1")).toEqual({ n: 2 });
  });
});
