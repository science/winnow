// The single persistence chokepoint (see CLAUDE.md). Prefers
// browser.storage.local (extension context); falls back to localStorage
// (plain-browser dev / demo mode) and then to an in-memory map (tests).
// All values JSON; all keys namespaced and versioned.

import { log } from "./logger";

export const KEYS = {
  settings: "winnow:settings:v1",
  /** Legacy single profile — migration source only (see profilesStore). */
  profile: "winnow:profile:v1",
  profiles: "winnow:profiles:v1",
  videos: "winnow:videos:v1",
  scores: "winnow:scores:v1",
  watched: "winnow:watched:v1",
  transcripts: "winnow:transcripts:v1",
  feedback: "winnow:feedback:v1",
  models: "winnow:models:v1",
  enrichment: "winnow:enrichment:v1",
  profileTarget: "winnow:profileTarget:v1",
} as const;

/** Per-profile key families (docs/DESIGN.md schema registry). Everything a
 * single profile owns lives under these keys; deleting a profile removes
 * exactly this set. */
export function profileKeys(profileId: string): {
  scores: string;
  profileTarget: string;
  feedback: string;
  discovered: string;
  discoverQueries: string;
} {
  return {
    scores: `winnow:scores:v2:${profileId}`,
    profileTarget: `winnow:profileTarget:v2:${profileId}`,
    feedback: `winnow:feedback:v2:${profileId}`,
    discovered: `winnow:discovered:v1:${profileId}`,
    discoverQueries: `winnow:discoverQueries:v1:${profileId}`,
  };
}

type WebExtStorage = {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (key: string) => Promise<void>;
};

declare const browser: { storage?: { local?: WebExtStorage } } | undefined;

const memory = new Map<string, string>();

function webExtArea(): WebExtStorage | null {
  try {
    return typeof browser !== "undefined" && browser?.storage?.local ? browser.storage.local : null;
  } catch {
    return null;
  }
}

function domStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export async function storageGet<T>(key: string): Promise<T | null> {
  try {
    const area = webExtArea();
    if (area) {
      const result = await area.get(key);
      const value = result[key];
      return value === undefined ? null : (value as T);
    }
    const raw = domStorage()?.getItem(key) ?? memory.get(key) ?? null;
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch (err) {
    // Corrupt/unavailable storage is a cache miss, not a crash.
    log.warn("storageGet failed for", key, err);
    return null;
  }
}

export async function storageSet<T>(key: string, value: T): Promise<void> {
  try {
    const area = webExtArea();
    if (area) {
      await area.set({ [key]: value });
      return;
    }
    const dom = domStorage();
    if (dom) dom.setItem(key, JSON.stringify(value));
    else memory.set(key, JSON.stringify(value));
  } catch (err) {
    log.warn("storageSet failed for", key, err);
  }
}

export async function storageRemove(key: string): Promise<void> {
  try {
    const area = webExtArea();
    if (area) {
      await area.remove(key);
      return;
    }
    domStorage()?.removeItem(key);
    memory.delete(key);
  } catch (err) {
    log.warn("storageRemove failed for", key, err);
  }
}
