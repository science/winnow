import { expect, test } from "@playwright/test";
import {
  expectRefreshModelsEnabled,
  getAnthropicModelOptions,
  getOpenAiModelOptions,
  openSettingsDemoWithState,
  readStoredJson,
  selectOpenAiModel,
} from "../helpers";
import type { Settings } from "../../src/lib/types";

// Demo mode: no keys, no network — the picker renders from the seeded
// catalog (winnow:models:v1) and persists selections to winnow:settings:v1.

test("should render defaults plus the seeded catalog and persist a selection", async ({ page }) => {
  await openSettingsDemoWithState(page, {
    models: {
      anthropic: ["claude-sonnet-5", "claude-haiku-4-5"],
      openai: ["gpt-5.4-mini", "gpt-5.4", "gpt-4.1"],
    },
  });

  // Defaults are part of the option lists (catalog contains them here).
  expect(await getAnthropicModelOptions(page)).toContain("claude-haiku-4-5");
  expect(await getOpenAiModelOptions(page)).toEqual(["gpt-5.4-mini", "gpt-5.4", "gpt-4.1"]);

  await selectOpenAiModel(page, "gpt-5.4");
  await expect
    .poll(async () => (await readStoredJson<Settings>(page, "winnow:settings:v1"))?.openaiModel)
    .toBe("gpt-5.4");
});

test("should keep working with no catalog: current models render, refresh is gated", async ({ page }) => {
  await openSettingsDemoWithState(page);
  // Fresh install: the selects still show the defaults (injected selection).
  expect(await getAnthropicModelOptions(page)).toEqual(["claude-haiku-4-5"]);
  expect(await getOpenAiModelOptions(page)).toEqual(["gpt-5.4-mini"]);
  // Demo mode / no keys: the network refresh can never fire.
  await expectRefreshModelsEnabled(page, false);
});
