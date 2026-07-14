// Credentialed fetch of youtube.com pages + extraction of the embedded
// ytInitialData blob. Works from extension contexts because the manifest's
// host_permissions exempt youtube.com from CORS and the fetch carries the
// user's session cookies.

import { log } from "../../lib/logger";
import { extractJsonBlob } from "./pageExtract";

export const FEED_URLS = {
  subscriptions: "https://www.youtube.com/feed/subscriptions",
  home: "https://www.youtube.com/",
} as const;

export class SignedOutError extends Error {
  constructor() {
    super("Not signed in to YouTube");
    this.name = "SignedOutError";
  }
}

export class PageParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageParseError";
  }
}

export interface YtPage {
  data: unknown;
  loggedIn: boolean | null;
  /** Raw ytInitialData JSON — kept for the debug fixture-capture affordance. */
  rawJson: string;
}

/**
 * Pull the `var ytInitialData = {...};` blob out of a page. Returns the
 * parsed object, or null when absent/malformed (consent wall, layout change).
 */
export function extractYtInitialData(html: string): unknown {
  const raw = rawYtInitialData(html);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function rawYtInitialData(html: string): string | null {
  return extractJsonBlob(html, /var ytInitialData\s*=\s*/);
}

/** Read the LOGGED_IN flag from ytcfg. Null when not found. */
export function extractLoggedIn(html: string): boolean | null {
  const m = /"LOGGED_IN"\s*:\s*(true|false)/.exec(html);
  if (!m) return null;
  return m[1] === "true";
}

// Last successful raw captures, for Settings' "copy debug fixture" button.
export const lastCaptures: Partial<Record<keyof typeof FEED_URLS, string>> = {};

/** Fetch a feed page as the logged-in user and extract its data blob. */
export async function fetchFeedPage(feed: keyof typeof FEED_URLS): Promise<YtPage> {
  const url = FEED_URLS[feed];
  log.debug("fetching", url);
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!res.ok) {
    throw new PageParseError(`YouTube returned HTTP ${res.status} for ${url}`);
  }
  const html = await res.text();
  const loggedIn = extractLoggedIn(html);
  if (loggedIn === false) throw new SignedOutError();
  const data = extractYtInitialData(html);
  if (data === null) {
    throw new PageParseError(
      "Could not find ytInitialData in the page — YouTube may have changed its layout, or a consent page is in the way.",
    );
  }
  const raw = rawYtInitialData(html);
  if (raw) lastCaptures[feed] = raw;
  return { data, loggedIn, rawJson: raw ?? "" };
}
