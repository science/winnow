// Anonymize a "copy debug fixture" bundle (Settings → copy debug fixture)
// so it can be committed. Strips session/account identifiers via
// scrubCapture, then refuses to write while scanSuspectKeys still flags
// residual PII-smelling keys — extend SCRUB_KEYS and re-run instead.
//
//   npx vite-node scripts/scrub-capture.ts <input.json> <output.json>
//
// Output is compact JSON; gzip it before committing (fixtures rule:
// commit the .json.gz, gitignore the unzipped file).

import { readFileSync, writeFileSync } from "node:fs";
import { scrubCapture, scanSuspectKeys } from "../src/lib/captureScrub";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: npx vite-node scripts/scrub-capture.ts <input.json> <output.json>");
  process.exit(1);
}

const bundle = JSON.parse(readFileSync(input, "utf8"));
const scrubbed = scrubCapture(bundle);
const suspects = scanSuspectKeys(scrubbed);

if (suspects.length > 0) {
  console.error("refusing to write — residual suspect keys after scrub:");
  for (const key of suspects) console.error(`  ${key}`);
  console.error("extend SCRUB_KEYS in src/lib/captureScrub.ts and re-run.");
  process.exit(1);
}

const json = JSON.stringify(scrubbed);
writeFileSync(output, json);
console.log(`scrubbed ${input} → ${output} (${(json.length / 1024 / 1024).toFixed(2)} MB, no suspect keys)`);
