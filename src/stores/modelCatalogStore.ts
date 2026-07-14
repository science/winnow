// Persisted model catalog for the Settings picker (winnow:models:v1).
// Fetched on explicit user action only ("Refresh model list"); persisted so
// the picker keeps working offline. Same init-from-storage / subscribe →
// persist pattern as settingsStore.

import { writable } from "svelte/store";
import { KEYS, storageGet, storageSet } from "../lib/storage";

export interface ModelCatalog {
  anthropic: string[];
  openai: string[];
  fetchedAt: number;
}

const EMPTY_CATALOG: ModelCatalog = { anthropic: [], openai: [], fetchedAt: 0 };

export const modelCatalog = writable<ModelCatalog>(EMPTY_CATALOG);

let persist = false;

export const modelCatalogReady: Promise<void> = (async () => {
  const stored = await storageGet<ModelCatalog>(KEYS.models);
  if (stored) modelCatalog.set({ ...EMPTY_CATALOG, ...stored });
  persist = true;
})();

modelCatalog.subscribe((value) => {
  if (persist) void storageSet(KEYS.models, value);
});
