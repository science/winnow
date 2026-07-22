// Diagnostic: run ONLY phase 2a — translate a profile into a ProfileTarget
// with live provider calls — and print the same audit lines Settings shows.
// Cheap (one small call per provider); use it to eyeball prompt changes
// against a real profile before shipping a TRANSLATOR_PROMPT_VERSION bump.
//
//   npx vite-node scripts/translate-diag.ts [provider|both]
//     DIAG_MORE / DIAG_LESS override the built-in profile text.
//
// Keys from .env.production (gitignored) or the environment.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { translateProfile, enrichmentModelFor } from "../src/services/scoring/twoPhase";
import { describeTarget } from "../src/lib/targetDisplay";
import type { Provider } from "../src/lib/types";
import { DIAG_DEFAULT_PROFILE } from "./diagProfile";

const here = dirname(fileURLToPath(import.meta.url));

function loadEnv(): void {
  try {
    const raw = readFileSync(join(here, "..", ".env.production"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!;
    }
  } catch {
    /* env-only */
  }
}
loadEnv();

// Default: the verbatim profile behind the 2026-07 gotham reports
// (DIAG_MORE/DIAG_LESS override; shared with probe-video.ts).
const profile = DIAG_DEFAULT_PROFILE;

const arg = process.argv[2] ?? "both";
const providers: Provider[] = arg === "both" ? ["anthropic", "openai"] : [arg as Provider];

for (const provider of providers) {
  const key = process.env[provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"];
  if (!key) {
    console.log(`\n=== ${provider}: no key, skipped ===`);
    continue;
  }
  const model = enrichmentModelFor(provider);
  const target = await translateProfile(profile, [], provider, key, model);
  console.log(`\n=== ${provider} (${model}) ===`);
  for (const line of describeTarget(target)) console.log(line);
}
