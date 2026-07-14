<script lang="ts">
  import { onMount } from "svelte";
  import { collapsed, initFeed, refresh, status, tiers, transcriptCoverage, videos, watched } from "../stores/feedStore";
  import { scoreFeed } from "../services/scoring/scorer";
  import VideoCard from "./VideoCard.svelte";

  let showWinnowed = $state(false);
  let showUnvetted = $state(false);

  onMount(() => {
    void initFeed().then(() => scoreFeed());
  });

  const watchedSet = $derived(new Set(Object.keys($watched)));
  // Unvetted videos never render as browsable feed items; leftovers that a
  // run couldn't score (failures, no key) stay reachable behind a fold.
  const unvetted = $derived($tiers.unscored.filter((v) => v.scoreState === "unknown"));

  async function onRefresh(): Promise<void> {
    await refresh();
    await scoreFeed();
  }
</script>

<div class="space-y-8">
  <div class="flex items-center justify-between">
    <div class="text-sm text-ink-muted" data-testid="feed-status">
      {#if $status.phase === "fetching"}
        {$status.detail}
      {:else if $status.phase === "scoring"}
        Scoring {$status.scoredCount}/{$status.scoreTotal}…
      {:else if $status.phase === "loading"}
        Loading…
      {/if}
    </div>
    <button
      onclick={onRefresh}
      disabled={$status.phase === "fetching" || $status.phase === "loading"}
      class="rounded-md bg-surface-raised px-3 py-1.5 text-sm text-ink hover:bg-surface-hover disabled:opacity-50"
      >Refresh</button
    >
  </div>

  {#if $transcriptCoverage}
    <p class="text-xs text-ink-faint" data-testid="transcript-coverage">
      transcripts on {$transcriptCoverage.fetched}/{$transcriptCoverage.attempted} videos this run
    </p>
  {/if}

  {#each $status.warnings as warning (warning)}
    <p class="rounded-md border border-caution/40 bg-caution/10 px-3 py-2 text-sm text-caution">{warning}</p>
  {/each}

  {#if $status.phase === "signedOut"}
    <section class="rounded-lg bg-surface-raised p-8 text-center" data-testid="signed-out">
      <h2 class="text-lg font-medium">You're not signed in to YouTube</h2>
      <p class="mx-auto mt-2 max-w-md text-sm text-ink-muted">
        Winnow reads your subscriptions and recommendations using your own YouTube session.
        Open <a href="https://www.youtube.com" target="_blank" rel="noreferrer" class="text-accent">youtube.com</a>,
        sign in, then come back and refresh.
      </p>
    </section>
  {:else}
    {#if $status.phase === "error"}
      <!-- A banner, not a replacement: scored tiers and the unvetted fold stay
           reachable after a failed refresh or an aborted scoring run. -->
      <section class="rounded-lg border border-danger/40 bg-danger/10 p-6" data-testid="feed-error">
        <h2 class="font-medium text-danger">Something went wrong</h2>
        <p class="mt-1 text-sm text-ink-muted">{$status.detail}</p>
      </section>
    {/if}
    {#if $status.phase === "loading" || ($status.phase === "fetching" && $videos.length === 0)}
    <div class="space-y-3" aria-hidden="true">
      {#each Array(5) as _unused, i (i)}
        <div class="flex animate-pulse gap-4 p-3">
          <div class="aspect-video w-48 rounded-md bg-surface-raised"></div>
          <div class="flex-1 space-y-2 py-1">
            <div class="h-4 w-3/4 rounded bg-surface-raised"></div>
            <div class="h-3 w-1/3 rounded bg-surface-raised"></div>
          </div>
        </div>
      {/each}
    </div>
  {:else if $videos.length === 0}
    {#if $status.phase !== "error"}
      <section class="rounded-lg bg-surface-raised p-8 text-center">
        <h2 class="text-lg font-medium">Nothing here yet</h2>
        <p class="mt-2 text-sm text-ink-muted">Hit Refresh to pull your subscriptions and recommendations.</p>
      </section>
    {/if}
  {:else}
    {#if $collapsed}
      <p class="rounded-md border border-caution/40 bg-caution/10 px-3 py-2 text-sm text-caution" data-testid="collapse-hint">
        Scores aren't differentiating your feed right now — try sharpening your profile in Settings
        (what do you want <em>less</em> of?). Numeric badges are hidden until then.
      </p>
    {/if}

    {#if $tiers.top.length > 0}
      <section data-testid="tier-top">
        <h2 class="mb-2 text-sm font-semibold uppercase tracking-wider text-accent">Top picks</h2>
        {#each $tiers.top as video (video.id)}
          <VideoCard {video} watched={watchedSet.has(video.id)} hideScoreNumber={$collapsed} />
        {/each}
      </section>
    {/if}

    {#if $tiers.worthALook.length > 0}
      <section data-testid="tier-worth">
        <h2 class="mb-2 text-sm font-semibold uppercase tracking-wider text-ink-muted">Worth a look</h2>
        {#each $tiers.worthALook as video (video.id)}
          <VideoCard {video} watched={watchedSet.has(video.id)} hideScoreNumber={$collapsed} />
        {/each}
      </section>
    {/if}

    {#if $status.phase === "scoring"}
      <section
        class="rounded-lg bg-surface-raised p-6"
        data-testid="scoring-progress"
        aria-live="polite"
      >
        <p class="text-sm text-ink-muted">
          Vetting {$status.scoredCount} of {$status.scoreTotal} videos…
        </p>
        {#if $status.detail}
          <p class="mt-1 text-xs text-ink-faint">{$status.detail}</p>
        {/if}
        <div class="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface">
          <div
            class="h-full rounded-full bg-accent transition-all duration-300"
            style="width: {$status.scoreTotal > 0 ? ($status.scoredCount / $status.scoreTotal) * 100 : 0}%"
          ></div>
        </div>
      </section>
    {:else if unvetted.length > 0}
      <section data-testid="tier-unvetted">
        <button
          onclick={() => (showUnvetted = !showUnvetted)}
          class="w-full rounded-md bg-surface-raised px-3 py-2 text-left text-sm text-ink-faint hover:bg-surface-hover"
          data-testid="unvetted-fold"
        >
          {showUnvetted ? "▾" : "▸"}
          {unvetted.length}
          {unvetted.length === 1 ? "video" : "videos"} awaiting vetting — {showUnvetted ? "hide" : "show"}
        </button>
        {#if showUnvetted}
          <div class="mt-2 opacity-70">
            {#each unvetted as video (video.id)}
              <VideoCard {video} watched={watchedSet.has(video.id)} />
            {/each}
            {#if $status.phase === "idle"}
              <button
                onclick={() => scoreFeed()}
                class="mt-2 rounded-md bg-surface-raised px-3 py-1.5 text-sm text-ink hover:bg-surface-hover"
                data-testid="retry-scoring">Retry scoring</button
              >
            {/if}
          </div>
        {/if}
      </section>
    {/if}

    {#if $tiers.winnowed.length > 0}
      <section data-testid="tier-winnowed">
        <button
          onclick={() => (showWinnowed = !showWinnowed)}
          class="w-full rounded-md bg-surface-raised px-3 py-2 text-left text-sm text-ink-faint hover:bg-surface-hover"
          data-testid="winnowed-fold"
        >
          {showWinnowed ? "▾" : "▸"}
          {$tiers.winnowed.length}
          {$tiers.winnowed.length === 1 ? "video" : "videos"} winnowed out — {showWinnowed ? "hide" : "show"}
        </button>
        {#if showWinnowed}
          <div class="mt-2 opacity-70">
            {#each $tiers.winnowed as video (video.id)}
              <VideoCard {video} watched={watchedSet.has(video.id)} hideScoreNumber={$collapsed} />
            {/each}
          </div>
        {/if}
      </section>
    {/if}

    <p class="pt-4 text-center text-xs text-ink-faint">
      That's everything from your subscriptions and recommendations. The page has a bottom.
    </p>
    {/if}
  {/if}
</div>
