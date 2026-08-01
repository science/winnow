<script lang="ts">
  import { onMount } from "svelte";
  import { embedUrl, watchUrl } from "../lib/embed";
  import { markWatched, scoredVideos } from "../stores/feedStore";
  import { discoveredScored } from "../stores/discoveryStore";
  import ScoreBadge from "./ScoreBadge.svelte";
  import VoteButtons from "./VoteButtons.svelte";
  import SubscribeButton from "./SubscribeButton.svelte";

  let { videoId }: { videoId: string } = $props();

  // Discoveries live in their own store, so resolving from the feed alone
  // rendered a bare player with no title, score, or votes for anything found
  // by "go deeper" — and this page is where following a new creator belongs.
  const video = $derived(
    $scoredVideos.find((v) => v.id === videoId) ??
      $discoveredScored.find((v) => v.id === videoId) ??
      null,
  );
  const isDiscovery = $derived(video?.source === "search");

  onMount(() => {
    void markWatched(videoId);
  });
</script>

<div class="space-y-4">
  <a href="#/" class="text-sm text-ink-muted hover:text-ink">← Back to feed</a>

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

  {#if video}
    <div class="space-y-2">
      <h1 class="text-lg font-medium leading-snug">{video.title}</h1>
      <p class="text-sm text-ink-muted">
        {video.channelTitle ?? "Unknown channel"}
        {#if video.publishedText}<span class="text-ink-faint"> · {video.publishedText}</span>{/if}
        {#if video.viewCountText}<span class="text-ink-faint"> · {video.viewCountText}</span>{/if}
      </p>
      {#if video.scoreState === "scored"}
        <ScoreBadge score={video.score} reason={video.reason} clickbait={video.clickbait} />
      {/if}
      <div class="flex flex-wrap items-center gap-1.5">
        <VoteButtons {video} />
        {#if isDiscovery}
          <SubscribeButton {video} />
        {/if}
      </div>
    </div>
  {/if}

  <p class="text-xs text-ink-faint">
    Player not working? Some videos disable embedding —
    <a
      href={watchUrl(videoId)}
      target="_blank"
      rel="noreferrer"
      class="text-accent">open it on YouTube</a
    >.
  </p>
</div>
