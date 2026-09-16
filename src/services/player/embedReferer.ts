// Registers the embed Referer rule (lib/embed.ts#embedRefererRules) for this
// install. It is a dynamic rule because its scope — this install's
// moz-extension host — is only known at runtime. Dynamic rules persist, and
// the replace is idempotent, so running it on every page load is just a
// cheap re-assertion.

import { embedRefererRules, EMBED_REFERER_RULE_ID } from "../../lib/embed";
import { log } from "../../lib/logger";

declare const browser:
  | {
      declarativeNetRequest?: {
        updateDynamicRules: (opts: { removeRuleIds: number[]; addRules: unknown[] }) => Promise<void>;
      };
    }
  | undefined;

let ready: Promise<void> | null = null;

/** Resolves once the player can be embedded. Never rejects: outside an
 * extension (dev server, e2e) there is nothing to register, and a failed
 * registration surfaces as YouTube's own error 153 screen in the player. */
export function embedRefererReady(): Promise<void> {
  ready ??= (async () => {
    const dnr = typeof browser !== "undefined" ? browser?.declarativeNetRequest : undefined;
    if (!dnr || location.protocol !== "moz-extension:") return;
    try {
      await dnr.updateDynamicRules({
        removeRuleIds: [EMBED_REFERER_RULE_ID],
        addRules: embedRefererRules(location.host),
      });
    } catch (err) {
      log.warn("embed referer rule registration failed", err);
    }
  })();
  return ready;
}
