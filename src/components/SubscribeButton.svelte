<script lang="ts">
  // Subscribe to a discovered creator. Two effects, both deliberate: the real
  // YouTube subscription (so the channel enters the actual subscriptions feed)
  // and an up-vote-equivalent on this video (so Winnow's ranking learns from
  // it). If the signed write fails, we hand off to YouTube's own confirmation
  // dialog rather than leaving a dead button.
  import type { ScoredVideo } from "../lib/types";
  import { subscribeToChannel, subConfirmationUrl } from "../services/youtube/subscribe";
  import { addSubscribedChannel, subscribedIds } from "../stores/subscriptionsStore";
  import { setVote } from "../stores/feedbackStore";
  import { scoreFeed } from "../services/scoring/scorer";
  import { isDemoMode } from "../services/youtube/feedSource";

  let { video }: { video: ScoredVideo } = $props();

  let busy = $state(false);
  let failed = $state(false);

  const subscribed = $derived(video.channelId !== null && $subscribedIds.has(video.channelId));

  async function subscribe(event: MouseEvent): Promise<void> {
    // Cards wrap everything in an <a>; subscribing must never navigate.
    event.preventDefault();
    event.stopPropagation();
    if (!video.channelId || busy) return;

    busy = true;
    failed = false;
    try {
      // Demo mode never touches the network — record the local side only, so
      // the whole flow stays exercisable offline.
      const outcome = isDemoMode()
        ? ({ subscribed: true } as const)
        : await subscribeToChannel(video.channelId);

      if (!("subscribed" in outcome)) {
        failed = true;
        return;
      }
      await addSubscribedChannel({
        channelId: video.channelId,
        channelTitle: video.channelTitle,
      });
      // The up-vote carries this video's digest into the profile translation,
      // so the whole feed re-ranks around the new interest.
      await setVote(video, "up");
      void scoreFeed();
    } finally {
      busy = false;
    }
  }
</script>

{#if video.channelId}
  {#if subscribed}
    <span
      class="rounded bg-surface-raised px-2 py-0.5 text-[11px] text-ink-faint"
      title="You subscribe to this creator on YouTube"
      data-testid="subscribed-badge">Subscribed</span
    >
  {:else if failed}
    <a
      href={subConfirmationUrl(video.channelId)}
      target="_blank"
      rel="noreferrer"
      onclick={(e) => e.stopPropagation()}
      class="rounded bg-caution/20 px-2 py-0.5 text-[11px] text-caution hover:bg-caution/30"
      title="Winnow couldn't subscribe directly — open YouTube's own subscribe dialog"
      data-testid="subscribe-fallback">Subscribe on YouTube ↗</a
    >
  {:else}
    <button
      type="button"
      disabled={busy}
      onclick={subscribe}
      title="Subscribe on YouTube and show me more from this creator"
      class="rounded bg-surface-raised px-2 py-0.5 text-[11px] text-ink-faint hover:bg-surface-hover hover:text-ink disabled:opacity-50"
      data-testid="subscribe">{busy ? "Subscribing…" : "Subscribe"}</button
    >
  {/if}
{/if}
