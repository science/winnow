// The one place Winnow writes to the user's YouTube account.
//
// Everything else in this codebase reads. Subscribing is a deliberate,
// explicit, user-initiated exception: it fires only from a Subscribe click,
// it subscribes to exactly the channel named, and it does nothing else.
// PRIVACY.md and the AMO listing describe this endpoint — keep them true.
//
// Auth: InnerTube's authenticated endpoints want Google's first-party
// SAPISIDHASH scheme, not cookies alone, so this reads the SAPISID cookie
// (the "cookies" permission exists for this and nothing else) and signs the
// request. The DNR rule that rewrites Origin on /youtubei/ requests
// (public/dnr-rules.json rule 2) already covers this endpoint — Google's
// anti-abuse layer bot-blocks the moz-extension:// origin Firefox would
// otherwise stamp. Do not add a rule; the existing path-prefix filter
// matches, and transcripts.test.ts pins that rule's exact shape.

import { sapisidHashHeader, YOUTUBE_ORIGIN } from "../../lib/sapisidHash";
import { getSapisid } from "./authCookies";
import { getInnertubeConfig, type InnertubeConfig } from "./ytPage";
import { log } from "../../lib/logger";

const SUBSCRIBE_URL = "https://www.youtube.com/youtubei/v1/subscription/subscribe";

/** The subscribe endpoint's constant params blob (base64 "\x08\x02"). Not a
 * per-channel token — the channel travels in channelIds. */
export const SUBSCRIBE_PARAMS = "EgIIAg%3D%3D";

export interface SubscribeSuccess {
  subscribed: true;
}

/** Per-stage failure marker, same self-diagnosing convention transcripts.ts
 * uses: the UI can name the broken stage instead of "something went wrong". */
export interface SubscribeFailure {
  failure: string;
}

export type SubscribeOutcome = SubscribeSuccess | SubscribeFailure;

export interface SubscribeDeps {
  fetchFn?: typeof fetch;
  getSapisidFn?: () => Promise<string | null>;
  getConfigFn?: () => Promise<InnertubeConfig | null>;
  now?: () => number;
}

/** YouTube's own subscribe-confirmation page. The fallback whenever the
 * signed write fails: the user still gets a real subscription, in one click,
 * through YouTube's native dialog. */
export function subConfirmationUrl(channelId: string): string {
  return `https://www.youtube.com/channel/${channelId}?sub_confirmation=1`;
}

/**
 * Subscribe the signed-in user to one channel. Never throws — failures come
 * back as `{ failure: <stage> }` so the caller can fall back to
 * subConfirmationUrl and name the stage if it wants to.
 *
 * No retry: per the house taxonomy a 4xx here is a bug or a missing session,
 * not weather, and a duplicate subscribe write is not something to gamble on.
 */
export async function subscribeToChannel(
  channelId: string,
  deps: SubscribeDeps = {},
): Promise<SubscribeOutcome> {
  const fetchFn = deps.fetchFn ?? fetch;
  const getSapisidFn = deps.getSapisidFn ?? getSapisid;
  const getConfigFn = deps.getConfigFn ?? getInnertubeConfig;
  const now = deps.now ?? Date.now;

  if (!channelId) return { failure: "no-channel-id" };

  const sapisid = await getSapisidFn();
  if (!sapisid) return { failure: "no-sapisid" };

  const config = await getConfigFn();
  if (!config) return { failure: "no-innertube-config" };

  try {
    const res = await fetchFn(SUBSCRIBE_URL, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Authorization: await sapisidHashHeader(sapisid, YOUTUBE_ORIGIN, now),
        "X-Origin": YOUTUBE_ORIGIN,
        "X-Goog-AuthUser": "0",
      },
      body: JSON.stringify({
        context: {
          client: { clientName: "WEB", clientVersion: config.clientVersion, hl: "en" },
        },
        channelIds: [channelId],
        params: SUBSCRIBE_PARAMS,
      }),
    });
    if (!res.ok) {
      log.warn("subscribe rejected", res.status, channelId);
      return { failure: `http-${res.status}` };
    }
    return { subscribed: true };
  } catch (err) {
    log.warn("subscribe network failure", err);
    return { failure: "network" };
  }
}
