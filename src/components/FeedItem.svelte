<script lang="ts">
  import type { ScoredVideo } from "../lib/types";
  import { openVideoId } from "../stores/playerStore";
  import VideoCard from "./VideoCard.svelte";
  import InlinePlayer from "./InlinePlayer.svelte";

  let {
    video,
    watched = false,
    hideScoreNumber = false,
    showSubscribe = false,
  }: {
    video: ScoredVideo;
    watched?: boolean;
    hideScoreNumber?: boolean;
    showSubscribe?: boolean;
  } = $props();

  const open = $derived($openVideoId === video.id);
</script>

<!-- The player is a SIBLING of the card, never a child: the card's root is an
     <a>, and an iframe cannot live inside one. -->
<div data-testid="feed-item">
  <VideoCard {video} {watched} {hideScoreNumber} {showSubscribe} {open} />
  {#if open}
    <InlinePlayer videoId={video.id} {video} />
  {/if}
</div>
