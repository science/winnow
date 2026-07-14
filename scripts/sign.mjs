// Sign dist/ as an unlisted add-on via AMO: web-ext-artifacts/*.xpi
// Credentials come from credentials/env.production (local, gitignored) or
// from the environment (CI: GitHub secrets). AMO permanently rejects
// re-signing an existing version — bump package.json AND public/manifest.json
// together before tagging (a unit test keeps the two in sync).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
if (!existsSync(resolve(dist, "manifest.json"))) {
  console.error("dist/manifest.json not found — run `npm run build` first.");
  process.exit(1);
}

const envFile = resolve(root, "credentials/env.production");
const env = { ...process.env };
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[1] !== undefined) env[m[1]] = m[2] ?? "";
  }
}
const issuer = env["MOZILLA_ADDONS_JWT_ISSUER"];
const secret = env["MOZILLA_ADDONS_JWT_SECRET"];
if (!issuer || !secret) {
  console.error(
    "Missing MOZILLA_ADDONS_JWT_ISSUER / MOZILLA_ADDONS_JWT_SECRET " +
      "(credentials/env.production locally, repo secrets in CI).",
  );
  process.exit(1);
}

// Secrets go via WEB_EXT_* env vars, never argv (visible in process lists).
const result = spawnSync(
  resolve(root, "node_modules/.bin/web-ext"),
  ["sign", "--source-dir", dist, "--artifacts-dir", resolve(root, "web-ext-artifacts"), "--channel", "unlisted", "--no-config-discovery"],
  {
    stdio: "inherit",
    env: { ...env, WEB_EXT_API_KEY: issuer, WEB_EXT_API_SECRET: secret },
  },
);
process.exit(result.status ?? 1);
