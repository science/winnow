// Boundary: read the SAPISID cookie needed to sign InnerTube requests
// (SAPISIDHASH). Requires the "cookies" permission (manifest.json) plus the
// youtube.com host permission. Outside an extension context (plain-browser
// dev, demo, tests) browser.cookies is absent and this returns null — callers
// degrade to cookies-only requests, exactly the pre-SAPISIDHASH behavior.

import { YOUTUBE_ORIGIN } from "../../lib/sapisidHash";

type CookiesApi = {
  get: (details: { url: string; name: string }) => Promise<{ value: string } | null>;
};

declare const browser: { cookies?: CookiesApi } | undefined;

function cookiesApi(): CookiesApi | null {
  try {
    return typeof browser !== "undefined" && browser?.cookies ? browser.cookies : null;
  } catch {
    return null;
  }
}

/** SAPISID (fallback __Secure-3PAPISID) for youtube.com, or null when the
 *  API/permission/cookie is unavailable. */
export async function getSapisid(): Promise<string | null> {
  const api = cookiesApi();
  if (!api) return null;
  try {
    for (const name of ["SAPISID", "__Secure-3PAPISID"]) {
      const cookie = await api.get({ url: YOUTUBE_ORIGIN, name });
      if (cookie?.value) return cookie.value;
    }
    return null;
  } catch {
    return null;
  }
}
