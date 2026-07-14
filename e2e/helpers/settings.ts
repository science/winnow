// All selectors for the settings surface live HERE, not in specs.
import { type Page } from "@playwright/test";

export async function openSettings(page: Page): Promise<void> {
  await page.goto("/feed.html#/settings");
}

export async function fillMoreOfProfile(page: Page, text: string): Promise<void> {
  await page.getByLabel(/more of this/i).fill(text);
  await page.getByLabel(/more of this/i).blur();
}

export async function fillAnthropicKey(page: Page, key: string): Promise<void> {
  await page.getByLabel(/anthropic api key/i).fill(key);
  await page.getByLabel(/anthropic api key/i).blur();
}

export async function fillOpenAiKey(page: Page, key: string): Promise<void> {
  await page.getByLabel(/openai api key/i).fill(key);
  await page.getByLabel(/openai api key/i).blur();
}

export async function isProviderSelected(page: Page, name: "Anthropic" | "OpenAI"): Promise<boolean> {
  return (await page.getByRole("radio", { name }).getAttribute("aria-checked")) === "true";
}

export async function selectProvider(page: Page, name: "Anthropic" | "OpenAI"): Promise<void> {
  await page.getByRole("radio", { name }).click();
}

/** Read persisted state straight from the localStorage fallback. */
export async function readStoredJson<T>(page: Page, key: string): Promise<T | null> {
  return page.evaluate((k) => {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as unknown) : null;
  }, key) as Promise<T | null>;
}
