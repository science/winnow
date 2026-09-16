// Where the user stopped watching each video, and whether that's worth
// resuming. The default embed is cookie-less by design (youtube-nocookie.com),
// so YouTube can't resume for us — server-side "continue watching" is a
// signed-in youtube.com feature, and even the opt-in signed-in player
// (Settings.accountWrites) is not documented to honor it. The position has
// to be ours.

/** Below this, "resuming" would just be an annoying jump past the intro. */
export const RESUME_MIN_SEC = 15;
/** Within this of the end, the video is done — start it fresh next time. */
export const FINISHED_TAIL_SEC = 15;
/** Bounded like every other cache here; oldest entries evict first. */
export const POSITIONS_CAP = 500;

export interface PlaybackPosition {
  positionSec: number;
  durationSec: number;
  updatedAt: number;
}

export interface PositionSample {
  positionSec: number;
  /** 0 when unknown: the player states the duration once and then sends
   * currentTime-only updates, so it is carried forward per video. */
  durationSec: number;
  at: number;
}

export function isFinished(positionSec: number, durationSec: number): boolean {
  if (!(durationSec > 0)) return false;
  return positionSec >= durationSec - FINISHED_TAIL_SEC;
}

/** Seconds to start playback at; 0 means "from the beginning". */
export function resumeStartSec(entry: PlaybackPosition | null | undefined): number {
  if (!entry) return 0;
  const { positionSec, durationSec } = entry;
  if (!Number.isFinite(positionSec) || positionSec <= 0) return 0;
  // A position past the end means the duration changed under us; seeking
  // there makes YouTube restart anyway, so be explicit about it.
  if (durationSec > 0 && positionSec > durationSec) return 0;
  if (isFinished(positionSec, durationSec)) return 0;
  if (positionSec < RESUME_MIN_SEC) return 0;
  return Math.floor(positionSec);
}

function validSample(sample: PositionSample): boolean {
  return Number.isFinite(sample.positionSec) && sample.positionSec >= 0;
}

/** Fold one telemetry sample into the map. Returns the SAME object when
 * nothing changed, so callers can skip a storage write cheaply. */
export function updatePositions(
  map: Record<string, PlaybackPosition>,
  videoId: string,
  sample: PositionSample,
  cap: number = POSITIONS_CAP,
): Record<string, PlaybackPosition> {
  if (!validSample(sample)) return map;

  const durationSec =
    Number.isFinite(sample.durationSec) && sample.durationSec > 0
      ? sample.durationSec
      : (map[videoId]?.durationSec ?? 0);

  if (isFinished(sample.positionSec, durationSec)) {
    if (!(videoId in map)) return map;
    const { [videoId]: _done, ...rest } = map;
    return rest;
  }

  const next: Record<string, PlaybackPosition> = {
    ...map,
    [videoId]: { positionSec: sample.positionSec, durationSec, updatedAt: sample.at },
  };

  const keys = Object.keys(next);
  if (keys.length <= cap) return next;
  keys
    .sort((a, b) => next[a]!.updatedAt - next[b]!.updatedAt)
    .slice(0, keys.length - cap)
    .forEach((id) => delete next[id]);
  return next;
}

export function prunePositions(
  map: Record<string, PlaybackPosition>,
  keepIds: ReadonlySet<string>,
): Record<string, PlaybackPosition> {
  return Object.fromEntries(Object.entries(map).filter(([id]) => keepIds.has(id)));
}
