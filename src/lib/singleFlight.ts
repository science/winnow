// Single-flight with rerun coalescing. A feed remount (watch → back) must
// not stack a second scoring pipeline on an in-flight one — that would
// double-fetch transcripts and double-spend enrichment calls. Calls landing
// mid-run share the in-flight promise and queue exactly one follow-up run,
// which re-reads its inputs (votes, settings) fresh.

/** Wrap an async run so concurrent calls coalesce. A rejection propagates to
 * every waiting caller, drops any queued rerun, and releases the slot. */
export function coalesceRuns(run: () => Promise<void>): () => Promise<void> {
  let inFlight: Promise<void> | null = null;
  let rerunRequested = false;
  return () => {
    if (inFlight) {
      rerunRequested = true;
      return inFlight;
    }
    inFlight = (async () => {
      try {
        do {
          rerunRequested = false;
          await run();
        } while (rerunRequested);
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };
}
