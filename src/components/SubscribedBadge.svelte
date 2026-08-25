<script lang="ts">
  // Marks a discovered creator the user already follows on YouTube. Read-only:
  // the set comes from parsing /feed/channels, and Winnow never writes to the
  // account. Discovery shows these videos rather than hiding them, sorted
  // below genuinely new creators.
  import type { ScoredVideo } from "../lib/types";
  import { subscribedIds } from "../stores/subscriptionsStore";

  let { video }: { video: ScoredVideo } = $props();

  const subscribed = $derived(video.channelId !== null && $subscribedIds.has(video.channelId));
</script>

{#if subscribed}
  <span
    class="rounded bg-surface-raised px-2 py-0.5 text-[11px] text-ink-faint"
    title="You already subscribe to this creator on YouTube"
    data-testid="subscribed-badge">Subscribed</span
  >
{/if}
