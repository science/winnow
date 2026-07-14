import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

// Live tier reads provider keys from .env.production (gitignored). Keys are
// injected into the page at test time, never baked into the build.
if (existsSync(".env.production")) {
  process.loadEnvFile(".env.production");
}

// Two tiers (see CLAUDE.md):
//  - nonlive (default, CI): the BUILT page in demo mode — fixture data,
//    stub scorer, zero network, zero keys.
//  - live (manual): real provider calls with keys from .env.production;
//    specs skip gracefully when keys are absent.
export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  use: {
    baseURL: "http://localhost:4173",
  },
  projects: [
    { name: "nonlive", testDir: "e2e/nonlive" },
    { name: "live", testDir: "e2e/live", timeout: 120_000 },
  ],
  webServer: {
    command: "npm run build && npm run preview",
    url: "http://localhost:4173/feed.html",
    reuseExistingServer: !process.env["CI"],
  },
});
