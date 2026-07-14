// SAPISIDHASH: Google's first-party API authorization scheme. InnerTube
// endpoints that reject cookies-only requests (401/403) accept
// `Authorization: SAPISIDHASH <ts>_<sha1("<ts> <SAPISID> <origin>")>` where
// ts is whole seconds and origin is the site the hash is claimed for —
// https://www.youtube.com here, regardless of the extension page's own origin.

export const YOUTUBE_ORIGIN = "https://www.youtube.com";

export async function sapisidHashHeader(
  sapisid: string,
  origin: string,
  now: () => number = Date.now,
): Promise<string> {
  const ts = Math.floor(now() / 1000);
  const bytes = new TextEncoder().encode(`${ts} ${sapisid} ${origin}`);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `SAPISIDHASH ${ts}_${hex}`;
}
