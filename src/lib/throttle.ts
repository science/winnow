// Time-gated call rate limiter, deliberately TIMER-FREE: the caller is the
// clock. The YouTube player posts telemetry ~4x/second while a video plays,
// so the next call is always the tick a timer would have provided, and
// `flush()` covers the tail when playback stops. No setInterval to leak, and
// unit tests need an injected clock rather than fake timers.

export interface Throttled<A extends unknown[]> {
  /** Run now if the interval has elapsed; otherwise hold these args pending. */
  call(...args: A): void;
  /** Run the pending call immediately, if there is one. */
  flush(): void;
  /** Forget the pending call. */
  cancel(): void;
}

export function throttle<A extends unknown[]>(
  fn: (...args: A) => void,
  intervalMs: number,
  now: () => number = Date.now,
): Throttled<A> {
  let lastRun = -Infinity;
  let pending: A | null = null;

  const run = (args: A): void => {
    lastRun = now();
    pending = null;
    fn(...args);
  };

  return {
    call(...args: A): void {
      if (now() - lastRun >= intervalMs) run(args);
      else pending = args;
    },
    flush(): void {
      if (pending) run(pending);
    },
    cancel(): void {
      pending = null;
    },
  };
}
