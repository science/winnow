// Parsing the YouTube embed's postMessage telemetry. Shapes captured from
// the real player in e2e/extension/playerTelemetry.test.mjs: with
// enablejsapi=1 and origin=<page origin>, the embed answers a
// {"event":"listening"} handshake with a stream of JSON-string
// {"event":"infoDelivery","info":{currentTime,duration,playerState,...}}.
//
// Same discipline as feedParser: a surprising shape is a skip, never a throw.
// This is a third-party wire format that can change without notice.

/** The only origin production accepts messages from. */
export const PLAYER_ORIGIN = "https://www.youtube-nocookie.com";

/** YT.PlayerState.ENDED */
const STATE_ENDED = 0;

export interface PlayerTelemetry {
  positionSec: number;
  durationSec: number;
  ended: boolean;
}

export function parsePlayerMessage(data: unknown): PlayerTelemetry | null {
  let payload: unknown = data;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  if (typeof payload !== "object" || payload === null) return null;

  const message = payload as { event?: unknown; info?: unknown };
  if (message.event !== "infoDelivery") return null;
  if (typeof message.info !== "object" || message.info === null) return null;

  const info = message.info as { currentTime?: unknown; duration?: unknown; playerState?: unknown };
  if (typeof info.currentTime !== "number" || !Number.isFinite(info.currentTime)) return null;

  return {
    positionSec: info.currentTime,
    durationSec: typeof info.duration === "number" && Number.isFinite(info.duration) ? info.duration : 0,
    ended: info.playerState === STATE_ENDED,
  };
}
