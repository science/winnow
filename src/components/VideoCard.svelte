<script lang="ts">
  import type { ScoredVideo } from "../lib/types";
  import ScoreBadge from "./ScoreBadge.svelte";
  import VoteButtons from "./VoteButtons.svelte";

  let {
    video,
    watched = false,
    hideScoreNumber = false,
  }: { video: ScoredVideo; watched?: boolean; hideScoreNumber?: boolean } = $props();
</script>

<a
  href={`#/watch/${video.id}`}
  class={`group flex gap-4 rounded-lg p-3 no-underline transition-colors hover:bg-surface-hover ${watched ? "opacity-45" : ""}`}
  data-testid="video-card"
>
  <div class="relative w-48 shrink-0 self-start">
    {#if video.thumbnailUrl}
      <img
        src={video.thumbnailUrl}
        alt=""
        loading="lazy"
        class="aspect-video w-full rounded-md bg-surface-hover object-cover"
      />
    {:else}
      <div class="aspect-video w-full rounded-md bg-surface-hover"></div>
    {/if}
    {#if video.isLive}
      <span class="absolute bottom-1 right-1 rounded bg-danger px-1 py-0.5 text-[10px] font-bold text-white">LIVE</span>
    {:else if video.durationText}
      <span class="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-0.5 text-[11px] font-medium tabular-nums text-white">
        {video.durationText}
      </span>
    {/if}
  </div>

  <div class="min-w-0 flex-1 space-y-1.5">
    <h3 class="line-clamp-2 font-medium leading-snug text-ink group-hover:text-white">
      {#if watched}<span title="Watched" class="mr-1 text-accent">✓</span>{/if}{video.title}
    </h3>
    <p class="truncate text-xs text-ink-muted">
      {video.channelTitle ?? "Unknown channel"}
      {#if video.publishedText}<span class="text-ink-faint"> · {video.publishedText}</span>{/if}
      {#if video.viewCountText}<span class="text-ink-faint"> · {video.viewCountText}</span>{/if}
      <span
        class="ml-1 rounded bg-surface-hover px-1 py-px text-[10px] uppercase tracking-wide text-ink-faint"
        title={video.source === "home" ? "From YouTube's recommendations" : "From your subscriptions"}
        >{video.source === "home" ? "rec" : "sub"}</span
      >
    </p>
    {#if video.scoreState === "scored"}
      <ScoreBadge score={video.score} reason={video.reason} clickbait={video.clickbait} hideNumber={hideScoreNumber} />
    {:else if video.scoreState === "pending"}
      <div class="text-xs text-ink-faint">scoring…</div>
    {/if}
    <VoteButtons {video} />
  </div>
</a>
