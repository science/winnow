// All selectors for the settings surface live HERE, not in specs.
import { expect, type Page } from "@playwright/test";
import type { FeedbackEntry, Profile } from "../../src/lib/types";

export async function openSettings(page: Page): Promise<void> {
  await page.goto("/feed.html#/settings");
}

/** Open settings in demo mode with optional pre-seeded votes, profile, and
 *  model catalog (winnow:models:v1). */
export async function openSettingsDemoWithState(
  page: Page,
  state: {
    feedback?: FeedbackEntry[];
    profile?: Pick<Profile, "moreOf" | "lessOf">;
    models?: { anthropic: string[]; openai: string[] };
    /** StoredTarget shape: { inputHash, target } (winnow:profileTarget:v1). */
    profileTarget?: unknown;
  } = {},
): Promise<void> {
  await page.addInitScript(
    (s) => {
      localStorage.clear();
      if (s.profileTarget) {
        localStorage.setItem("winnow:profileTarget:v1", JSON.stringify(s.profileTarget));
      }
      if (s.feedback) {
        localStorage.setItem(
          "winnow:feedback:v1",
          JSON.stringify(Object.fromEntries(s.feedback.map((e) => [e.videoId, e]))),
        );
      }
      if (s.profile) {
        localStorage.setItem(
          "winnow:profile:v1",
          JSON.stringify({ ...s.profile, updatedAt: Date.now() }),
        );
      }
      if (s.models) {
        localStorage.setItem(
          "winnow:models:v1",
          JSON.stringify({ ...s.models, fetchedAt: Date.now() }),
        );
      }
    },
    state,
  );
  await page.goto("/feed.html?demo=1#/settings");
}

export async function expectSuggestProfileEnabled(page: Page, enabled: boolean): Promise<void> {
  if (enabled) await expect(page.getByTestId("suggest-profile")).toBeEnabled();
  else await expect(page.getByTestId("suggest-profile")).toBeDisabled();
}

export async function clickSuggestProfile(page: Page): Promise<void> {
  await page.getByTestId("suggest-profile").click();
}

export async function getSuggestionText(page: Page, timeoutMs = 60_000): Promise<string> {
  await expect(page.getByTestId("profile-suggestion")).toBeVisible({ timeout: timeoutMs });
  return page.getByTestId("profile-suggestion").innerText();
}

export async function applySuggestion(page: Page): Promise<void> {
  await page.getByTestId("apply-suggestion").click();
}

export async function dismissSuggestion(page: Page): Promise<void> {
  await page.getByTestId("dismiss-suggestion").click();
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

export async function selectAnthropicModel(page: Page, id: string): Promise<void> {
  await page.getByLabel(/anthropic model/i).selectOption(id);
}

export async function selectOpenAiModel(page: Page, id: string): Promise<void> {
  await page.getByLabel(/openai model/i).selectOption(id);
}

export async function getAnthropicModelOptions(page: Page): Promise<string[]> {
  return page.getByLabel(/anthropic model/i).locator("option").allTextContents();
}

export async function getOpenAiModelOptions(page: Page): Promise<string[]> {
  return page.getByLabel(/openai model/i).locator("option").allTextContents();
}

export async function expectRefreshModelsEnabled(page: Page, enabled: boolean): Promise<void> {
  if (enabled) await expect(page.getByTestId("refresh-models")).toBeEnabled();
  else await expect(page.getByTestId("refresh-models")).toBeDisabled();
}

export async function getTargetViewerLines(page: Page): Promise<string[]> {
  await expect(page.getByTestId("target-viewer")).toBeVisible();
  return page.getByTestId("target-viewer").locator("li").allTextContents();
}

export async function expectTargetViewerEmpty(page: Page): Promise<void> {
  await expect(page.getByTestId("target-viewer-empty")).toBeVisible();
}

/** Read persisted state straight from the localStorage fallback. */
export async function readStoredJson<T>(page: Page, key: string): Promise<T | null> {
  return page.evaluate((k) => {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as unknown) : null;
  }, key) as Promise<T | null>;
}

/** The active entry of the persisted profiles collection (winnow:profiles:v1). */
export async function readActiveProfile(page: Page): Promise<Profile | null> {
  const state = await readStoredJson<{
    activeProfileId: string;
    profiles: (Profile & { id: string })[];
  }>(page, "winnow:profiles:v1");
  if (!state) return null;
  return state.profiles.find((p) => p.id === state.activeProfileId) ?? null;
}
