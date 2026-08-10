<script lang="ts">
  import { onMount } from "svelte";
  import { embedUrl, watchUrl } from "../lib/embed";
  import { formatDuration } from "../lib/format";
  import { navigate } from "../lib/router";
  import type { ScoredVideo } from "../lib/types";
  import { listenToPlayer } from "../services/player/playerTelemetry";
  import { flushPositions, playbackReady, recordPosition, resumeStartFor } from "../stores/playbackStore";

  let {
    videoId,
    video = null,
  }: {
    videoId: string;
    /** Null for a deep link to a video that is not in the feed window. */
    video?: ScoredVideo | null;
  } = $props();

  let panel = $state<HTMLElement | null>(null);
  let frame = $state<HTMLIFrameElement | null>(null);
  // Null until the stored position is read — the iframe waits rather than
  // starting at 0 and yanking the user back a moment later.
  let startSec = $state<number | null>(null);

  const src = $derived(
    startSec === null
      ? null
      : embedUrl(videoId, { startSec, jsApi: true, origin: location.origin }),
  );

  function close(): void {
    navigate({ name: "feed" });
  }

  function restart(): void {
    startSec = 0;
  }

  onMount(() => {
    panel?.scrollIntoView({ block: "nearest" });
    void playbackReady.then(() => {
      startSec = resumeStartFor(videoId);
    });

    // Escape is a bonus, not the contract: while focus is inside the
    // cross-origin iframe the browser gives us no key events at all. The
    // visible close button is the guaranteed way out.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close();
    };
    // storageSet is async and browser.storage.local.set is not guaranteed to
    // settle during pagehide; visibilitychange fires earlier and reliably on
    // tab switch/close, so it is the real safety net. Worst case on a hard
    // kill is losing PERSIST_INTERVAL_MS of position.
    const onHide = (): void => {
      void flushPositions();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") onHide();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  });

  // Re-runs when the src changes (start-from-the-beginning reloads the frame,
  // which needs a fresh listening handshake).
  $effect(() => {
    const el = frame;
    const url = src;
    if (!el || !url) return;
    const stop = listenToPlayer(el, (telemetry) => recordPosition(videoId, telemetry));
    return () => {
      stop();
      void flushPositions();
    };
  });
</script>

<div bind:this={panel} class="mb-3 space-y-2 rounded-b-lg bg-surface-raised p-3" data-testid="inline-player">
  <div class="flex items-center justify-between gap-3">
    <p class="truncate text-sm text-ink-muted">{video?.title ?? videoId}</p>
    <button
      type="button"
      onclick={close}
      class="shrink-0 rounded-md bg-surface px-3 py-1.5 text-sm text-ink hover:bg-surface-hover"
      data-testid="close-player">Close player ✕</button
    >
  </div>

  <!-- embedUrl carries the start-on-open/nocookie rationale; the DNR rule in
       public/dnr-rules.json injects the Referer YouTube requires (error 153).
       allow="autoplay" is required or the browser ignores autoplay=1. -->
  <div class="aspect-video w-full overflow-hidden rounded-lg bg-black">
    {#if src}
      <iframe
        bind:this={frame}
        data-testid="watch-embed"
        {src}
        title={video?.title ?? "YouTube video"}
        class="h-full w-full"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowfullscreen
      ></iframe>
    {/if}
  </div>

  {#if startSec !== null && startSec > 0}
    <p class="text-xs text-ink-muted" data-testid="resume-notice">
      Resuming at {formatDuration(startSec)} ·
      <button
        type="button"
        onclick={restart}
        class="text-accent underline-offset-2 hover:underline"
        data-testid="restart-video">Start from the beginning</button
      >
    </p>
  {/if}

  <p class="text-xs text-ink-faint">
    Player not working? Some videos disable embedding —
    <a href={watchUrl(videoId)} target="_blank" rel="noreferrer" class="text-accent">open it on YouTube</a>.
  </p>
</div>
