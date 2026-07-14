<script lang="ts">
  import { onMount } from "svelte";
  import { markWatched, scoredVideos } from "../stores/feedStore";
  import ScoreBadge from "./ScoreBadge.svelte";
  import VoteButtons from "./VoteButtons.svelte";

  let { videoId }: { videoId: string } = $props();

  const video = $derived($scoredVideos.find((v) => v.id === videoId) ?? null);

  onMount(() => {
    void markWatched(videoId);
  });
</script>

<div class="space-y-4">
  <a href="#/" class="text-sm text-ink-muted hover:text-ink">← Back to feed</a>

  <!-- youtube-nocookie + no autoplay: nothing plays until the user presses
       play, and nothing queues after it ends. rel=0 limits end-screen
       suggestions to the same channel (full suppression isn't possible). -->
  <div class="aspect-video w-full overflow-hidden rounded-lg bg-black">
    <iframe
      src={`https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1`}
      title={video?.title ?? "YouTube video"}
      class="h-full w-full"
      allow="encrypted-media; picture-in-picture; fullscreen"
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
      <VoteButtons {video} />
    </div>
  {/if}

  <p class="text-xs text-ink-faint">
    Player not working? Some videos disable embedding —
    <a
      href={`https://www.youtube.com/watch?v=${videoId}`}
      target="_blank"
      rel="noreferrer"
      class="text-accent">open it on YouTube</a
    >.
  </p>
</div>
