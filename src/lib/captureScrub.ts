// Anonymizes "copy debug fixture" bundles (Settings → copyFixture) so raw
// signed-in YouTube captures can be committed as fixtures. Strips session
// and account identifiers; video/recommendation content itself stays.
// scripts/scrub-capture.ts is the CLI wrapper and refuses to write while
// scanSuspectKeys still flags anything.

/** Keys dropped wherever they appear, at any depth. */
export const SCRUB_KEYS: readonly string[] = [
  "responseContext",
  "clickTrackingParams",
  "trackingParams",
  "trackingParam",
  "feedbackToken",
  "undoToken",
  "visitorData",
  "datasyncId",
  "rolloutToken",
  "playbackTracking",
  "attestation",
  "serviceIntegrityDimensions",
  "poToken",
  "continuation",
  "continuationCommand",
  "continuationEndpoint",
  "token",
  // Creator avatars and player/experiment config: nothing in src/ reads
  // them, and they trip the suspect scan (avatar*, enable*Token* flags).
  "avatar",
  "avatars",
  "avatarViewModel",
  "avatarStackViewModel",
  "decoratedAvatarViewModel",
  "playerConfig",
  "playerOverlayLayerRenderers",
  "experiments",
  "mainAppContext",
];

/** Feed-capture subtrees dropped from the top level of each feed part —
 * everything the parser reads lives under `contents`; `topbar` carries the
 * signed-in account name/avatar. */
export const FEED_PART_DROP_KEYS: readonly string[] = [
  "topbar",
  "header",
  "frameworkUpdates",
  "onResponseReceivedActions",
];

const FEED_PARTS = ["home", "subscriptions"] as const;

const SUSPECT_RE = /token|tracking|visitor|datasync|rollout|account|email|avatar/i;

function scrubNode(node: unknown, dropAtThisLevel: readonly string[]): unknown {
  if (Array.isArray(node)) return node.map((item) => scrubNode(item, []));
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (SCRUB_KEYS.includes(key) || dropAtThisLevel.includes(key)) continue;
    out[key] = scrubNode(value, []);
  }
  return out;
}

/** Returns a scrubbed deep copy of a capture bundle; the input is untouched. */
export function scrubCapture(bundle: unknown): unknown {
  if (bundle === null || typeof bundle !== "object" || Array.isArray(bundle)) {
    return scrubNode(bundle, []);
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(bundle)) {
    const isFeedPart = (FEED_PARTS as readonly string[]).includes(key);
    out[key] = scrubNode(value, isFeedPart ? FEED_PART_DROP_KEYS : []);
  }
  return out;
}

/** Residual-PII tripwire: any key that still smells like a session/account
 * identifier after scrubbing. YouTube renames keys without notice — new
 * names must surface here instead of silently leaking into fixtures. */
export function scanSuspectKeys(node: unknown): string[] {
  const found = new Set<string>();
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (n === null || typeof n !== "object") return;
    for (const [key, value] of Object.entries(n)) {
      if (SUSPECT_RE.test(key)) found.add(key);
      walk(value);
    }
  };
  walk(node);
  return [...found];
}
