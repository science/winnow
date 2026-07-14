// Live tier: the model-catalog boundary against each provider's real
// /v1/models — proves the endpoints stay browser-listable and that our
// default model ids actually exist server-side.
import { expect, test } from "@playwright/test";
import { fetchProviderModels } from "../../src/services/scoring/modelCatalog";
import { ANTHROPIC_MODEL } from "../../src/services/scoring/anthropicScorer";
import { OPENAI_MODEL } from "../../src/services/scoring/openaiScorer";

test("should list Anthropic models including the scoring default's snapshot", async () => {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  test.skip(!apiKey, "ANTHROPIC_API_KEY not set — live tier needs .env.production or env keys");
  const ids = await fetchProviderModels("anthropic", apiKey!);
  expect(ids.length).toBeGreaterThan(0);
  // Anthropic's list endpoint returns dated snapshot ids
  // (claude-haiku-4-5-20251001); the undated alias we score with is valid
  // for Messages but absent from the list. Prefix match covers both.
  expect(ids.some((id) => id.startsWith(ANTHROPIC_MODEL))).toBe(true);
});

test("should list OpenAI gpt models including the scoring default", async () => {
  const apiKey = process.env["OPENAI_API_KEY"];
  test.skip(!apiKey, "OPENAI_API_KEY not set — live tier needs .env.production or env keys");
  const ids = await fetchProviderModels("openai", apiKey!);
  expect(ids.length).toBeGreaterThan(0);
  expect(ids).toContain(OPENAI_MODEL);
  expect(ids.every((id) => id.startsWith("gpt-"))).toBe(true);
});
