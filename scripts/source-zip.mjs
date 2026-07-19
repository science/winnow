// Package the source for AMO source-code submission: web-ext-artifacts/winnow-<version>-source.zip
// Tracked files only (git archive) — credentials/, web-ext-artifacts/, node_modules/ never included.
import { execSync } from "node:child_process";
import { mkdirSync, existsSync, rmSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dirty = execSync("git status --porcelain", { cwd: root, encoding: "utf8" }).trim();
if (dirty) {
  console.error("working tree is dirty — the source zip is cut from HEAD and would not match:\n" + dirty);
  process.exit(1);
}
const version = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
const outDir = resolve(root, "web-ext-artifacts");
mkdirSync(outDir, { recursive: true });
const out = resolve(outDir, `winnow-${version}-source.zip`);
if (existsSync(out)) rmSync(out);
execSync(`git archive --format=zip -o ${JSON.stringify(out)} HEAD`, { cwd: root });
console.log(`wrote ${out}`);
