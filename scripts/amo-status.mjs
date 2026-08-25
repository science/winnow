#!/usr/bin/env node
// Read-only AMO status check: what is actually published, and is the
// submission complete? Run it after every Dev Hub upload (release checklist
// step 6 in docs/DEVELOPMENT.md) — the automated review approves a version
// whether or not source code was attached, so "approved" is not "done".
//
// Credentials: gitignored credentials/env.production (JWT issuer + secret,
// the same pair npm run sign uses). Makes GET requests only.

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ADDON = "winnow@misuse.org";
const API = "https://addons.mozilla.org/api/v5";

function credentials() {
  const path = resolve(REPO, "credentials/env.production");
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    console.error(`No credentials at ${path} — this check needs the AMO JWT pair.`);
    process.exit(1);
  }
  const env = Object.fromEntries(
    raw
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
      }),
  );
  return { issuer: env.MOZILLA_ADDONS_JWT_ISSUER, secret: env.MOZILLA_ADDONS_JWT_SECRET };
}

/** AMO's JWT scheme: HS256, short-lived, one per request run. */
function authHeader() {
  const { issuer, secret } = credentials();
  if (!issuer || !secret) {
    console.error("credentials/env.production is missing the JWT issuer/secret pair.");
    process.exit(1);
  }
  /** @param {Record<string, unknown>} obj */
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ iss: issuer, jti: String(Math.random()), iat, exp: iat + 280 });
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return { Authorization: `JWT ${head}.${body}.${sig}` };
}

/**
 * @param {string} url
 * @param {Record<string, string>} headers
 * @returns {Promise<any>}
 */
async function get(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

const headers = authHeader();
const list = await get(`${API}/addons/addon/${ADDON}/versions/?filter=all_with_unlisted`, headers);

for (const summary of list.results ?? []) {
  const version = await get(`${API}/addons/addon/${ADDON}/versions/${summary.id}/`, headers);
  const file = version.file ?? {};
  const problems = [];
  if (version.channel === "listed" && !version.source) {
    // Vite/Svelte/Tailwind make this package generated code end to end.
    problems.push("NO SOURCE ATTACHED (required — the build minifies and bundles)");
  }
  if (version.channel === "listed" && !(version.approval_notes ?? "").trim()) {
    problems.push("no reviewer notes (paste them from docs/store/AMO_LISTING.md)");
  }
  if ((file.permissions ?? []).includes("cookies")) {
    problems.push("requests the cookies permission — Winnow ships read-only");
  }
  console.log(
    [
      `${version.version.padEnd(8)} ${version.channel.padEnd(8)} ${file.status ?? "?"}`,
      `  uploaded ${file.created ?? "?"}   reviewed ${version.reviewed ?? "not yet"}`,
      `  permissions: ${(file.permissions ?? []).join(", ") || "none"}`,
      `  source: ${version.source ? "attached" : "none"}`,
      problems.length ? `  ⚠ ${problems.join("\n  ⚠ ")}` : "  ok",
    ].join("\n"),
  );
}
