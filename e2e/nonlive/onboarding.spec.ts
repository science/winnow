import { test, expect } from "@playwright/test";
import {
  openOnboarding,
  expectOnboardingVisible,
  openSettings,
  fillMoreOfProfile,
  fillAnthropicKey,
  readStoredJson,
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
  const profile = await readStoredJson<{ moreOf: string }>(page, "winnow:profile:v1");
  expect(profile?.moreOf).toBe("long-form science explainers");
});
