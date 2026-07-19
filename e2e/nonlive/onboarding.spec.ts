import { test, expect } from "@playwright/test";
import {
  openOnboarding,
  expectOnboardingVisible,
  expectFeedSurfaceVisible,
  getOnboardingMissingText,
  openSettings,
  fillMoreOfProfile,
  fillAnthropicKey,
  fillOpenAiKey,
  isProviderSelected,
  readStoredJson,
  readActiveProfile,
} from "../helpers";

test("should show onboarding on first run when nothing is configured", async ({ page }) => {
  await openOnboarding(page);
  await expectOnboardingVisible(page);
});

test("should persist settings and profile edits", async ({ page }) => {
  await openSettings(page);
  await fillAnthropicKey(page, "sk-ant-test-not-real");
  await fillMoreOfProfile(page, "long-form science explainers");

  const settings = await readStoredJson<{ anthropicApiKey: string }>(page, "winnow:settings:v1");
  expect(settings?.anthropicApiKey).toBe("sk-ant-test-not-real");
  const profile = await readActiveProfile(page);
  expect(profile?.moreOf).toBe("long-form science explainers");
});

test("should open the feed when only an OpenAI key is configured", async ({ page }) => {
  // Regression: provider defaults to anthropic; an OpenAI-only setup used to
  // leave the app silently unconfigured with a dead "Open my feed" link.
  await openOnboarding(page);
  await expectOnboardingVisible(page);
  await fillOpenAiKey(page, "sk-test-not-real");
  expect(await isProviderSelected(page, "OpenAI")).toBe(true);
  await fillMoreOfProfile(page, "long-form science explainers");
  await expectFeedSurfaceVisible(page);
});

test("should say what is still missing instead of a dead button", async ({ page }) => {
  await openOnboarding(page);
  const missing = await getOnboardingMissingText(page);
  expect(missing).toMatch(/api key/i);
  expect(missing).toMatch(/interest profile/i);
});
