import { defineConfig } from "@playwright/test";

// Free-tier e2e: runs the BUILT extension page in a plain browser in demo
// mode (?demo=1) — fixture data, stub scorer, zero network, zero keys.
export default defineConfig({
  testDir: "e2e/nonlive",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  use: {
    baseURL: "http://localhost:4173",
  },
  webServer: {
    command: "npm run build && npm run preview",
    url: "http://localhost:4173/feed.html",
    reuseExistingServer: !process.env["CI"],
  },
});
