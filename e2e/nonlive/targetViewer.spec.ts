// Settings must show how the free-text profile was translated into ranking
// constraints — the criteria are derived from the user's words, and this
// panel is where that derivation stays auditable.
import { test, expect } from "@playwright/test";
import {
  expectTargetViewerEmpty,
  getTargetViewerLines,
  openSettingsDemoWithState,
} from "../helpers";

test("shows the translated profile target constraints", async ({ page }) => {
  await openSettingsDemoWithState(page, {
    profileTarget: {
      inputHash: "abc",
      target: {
        fields: { claimOverreach: { target: 1, importance: 9 } },
        topicsMore: { items: ["top tier chess"], importance: 9 },
        topicsLess: { items: ["comic chess"], importance: 8 },
        formatsAvoid: { items: [], importance: 0 },
        tonesAvoid: { items: [], importance: 0 },
      },
    },
  });
  const lines = await getTargetViewerLines(page);
  expect(lines).toContain("Claim overreach: aim 1/5 — importance 9/10");
  expect(lines).toContain("Topics sought: top tier chess — importance 9/10");
  expect(lines).toContain("Topics avoided: comic chess — importance 8/10");
});

test("shows an empty state before any two-phase scoring run", async ({ page }) => {
  await openSettingsDemoWithState(page);
  await expectTargetViewerEmpty(page);
});
