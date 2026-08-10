<script lang="ts">
  import { onMount } from "svelte";
  import { embedUrl, watchUrl } from "../lib/embed";
  import { navigate } from "../lib/router";
  import type { ScoredVideo } from "../lib/types";

  let {
    videoId,
    video = null,
  }: {
    videoId: string;
    /** Null for a deep link to a video that is not in the feed window. */
    video?: ScoredVideo | null;
  } = $props();

  let panel = $state<HTMLElement | null>(null);

  function close(): void {
    navigate({ name: "feed" });
  }

  onMount(() => {
    panel?.scrollIntoView({ block: "nearest" });
    // Escape is a bonus, not the contract: while focus is inside the
    // cross-origin iframe the browser gives us no key events at all. The
    // visible close button is the guaranteed way out.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
    <iframe
      data-testid="watch-embed"
      src={embedUrl(videoId)}
      title={video?.title ?? "YouTube video"}
      class="h-full w-full"
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
      allowfullscreen
    ></iframe>
  </div>

  <p class="text-xs text-ink-faint">
    Player not working? Some videos disable embedding —
    <a href={watchUrl(videoId)} target="_blank" rel="noreferrer" class="text-accent">open it on YouTube</a>.
  </p>
</div>
