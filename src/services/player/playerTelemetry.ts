// The only module that talks to the embedded player. Thin by design: all the
// judgement lives in lib/playerMessage.ts and lib/playbackPosition.ts.
//
// Protocol (measured in e2e/extension/playerTelemetry.test.mjs): with
// enablejsapi=1 and origin=<the page's own origin>, posting
// {"event":"listening"} to the frame makes it stream infoDelivery messages
// carrying currentTime/duration/playerState. It is LISTEN-ONLY — Winnow never
// sends the player a command.

import { parsePlayerMessage, PLAYER_ORIGIN, type PlayerTelemetry } from "../../lib/playerMessage";

/** The player answers polls rather than pushing on its own: stopping the
 * `listening` posts after the first reply froze the position at the first
 * sample (measured 2026-08-09 by the round-trip test in
 * e2e/extension/playerTelemetry.test.mjs). So this keeps polling for the life
 * of the player — one tiny postMessage twice a second. */
const HANDSHAKE_INTERVAL_MS = 500;

/** Start listening to a player. Returns a disposer. */
export function listenToPlayer(
  iframe: HTMLIFrameElement,
  onUpdate: (telemetry: PlayerTelemetry) => void,
): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;

  const stopHandshake = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const handshake = (): void => {
    try {
      iframe.contentWindow?.postMessage(
        JSON.stringify({ event: "listening", id: 1, channel: "widget" }),
        PLAYER_ORIGIN,
      );
    } catch {
      // Frame not navigable yet — the next tick retries.
    }
  };

  const onMessage = (event: MessageEvent): void => {
    // Hard origin + source filter: this listener is on the extension page,
    // where any frame could post to us.
    if (event.source !== iframe.contentWindow || event.origin !== PLAYER_ORIGIN) return;
    const telemetry = parsePlayerMessage(event.data);
    if (!telemetry) return;
    onUpdate(telemetry);
  };

  window.addEventListener("message", onMessage);
  iframe.addEventListener("load", handshake);
  timer = setInterval(handshake, HANDSHAKE_INTERVAL_MS);
  handshake();

  return () => {
    stopHandshake();
    window.removeEventListener("message", onMessage);
    iframe.removeEventListener("load", handshake);
  };
}
