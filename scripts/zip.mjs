// Package dist/ as a web-ext-style zip: web-ext-artifacts/winnow-<version>.zip
// The zip root must contain manifest.json directly (no wrapping folder).
import { execSync } from "node:child_process";
import { mkdirSync, existsSync, rmSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
if (!existsSync(resolve(dist, "manifest.json"))) {
  console.error("dist/manifest.json not found — run `npm run build` first.");
  process.exit(1);
}
const version = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
const outDir = resolve(root, "web-ext-artifacts");
mkdirSync(outDir, { recursive: true });
const out = resolve(outDir, `winnow-${version}.zip`);
if (existsSync(out)) rmSync(out);
execSync(`zip -r -q ${JSON.stringify(out)} .`, { cwd: dist });
console.log(`wrote ${out}`);
