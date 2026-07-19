<script lang="ts">
  import { onMount } from "svelte";
  import { collapsed, initFeed, refresh, status, tiers, transcriptCoverage, videos, watched } from "../stores/feedStore";
  import { profilesState, switchProfile } from "../stores/profilesStore";
  import { discovered, discoveryStatus, discoveryTiers } from "../stores/discoveryStore";
  import { regenerateQueriesAndDiscover, runDiscovery } from "../services/discovery/discovery";
  import { scoreFeed } from "../services/scoring/scorer";
  import VideoCard from "./VideoCard.svelte";

  let showWinnowed = $state(false);
  let showUnvetted = $state(false);
  let showDiscoveryWinnowed = $state(false);

  const discoveryBusy = $derived(
    $discoveryStatus.phase === "generating" || $discoveryStatus.phase === "searching",
  );
  const discoveryBrowsable = $derived([...$discoveryTiers.top, ...$discoveryTiers.worthALook]);
  const discoveryVetting = $derived(
    $discoveryTiers.unscored.filter((v) => v.scoreState === "pending").length,
  );

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
    <div class="flex items-center gap-2">
      {#if $profilesState.profiles.length > 1}
        <select
          data-testid="profile-switcher"
          aria-label="Active profile"
          class="rounded-md bg-surface-raised px-2 py-1.5 text-sm text-ink hover:bg-surface-hover"
          value={$profilesState.activeProfileId}
          onchange={(e) => switchProfile(e.currentTarget.value)}
        >
          {#each $profilesState.profiles as p (p.id)}
            <option value={p.id}>{p.name}</option>
          {/each}
        </select>
      {/if}
      <button
        onclick={onRefresh}
        disabled={$status.phase === "fetching" || $status.phase === "loading"}
        class="rounded-md bg-surface-raised px-3 py-1.5 text-sm text-ink hover:bg-surface-hover disabled:opacity-50"
        >Refresh</button
      >
    </div>
  </div>

  {#if $transcriptCoverage}
    <p class="text-xs text-ink-faint" data-testid="transcript-coverage">
      transcripts on {$transcriptCoverage.fetched}/{$transcriptCoverage.attempted} videos this run{#if Object.keys($transcriptCoverage.failures).length > 0}
        — failures: {Object.entries($transcriptCoverage.failures)
          .map(([stage, n]) => `${stage} ×${n}`)
          .join(", ")}{/if}
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

    <section class="space-y-3 border-t border-surface-hover pt-6" data-testid="discovery">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-ink-muted">Discovery</h2>
        <div class="flex items-center gap-2">
          {#if $discovered.length > 0 || $discoveryStatus.detail}
            <button
              onclick={() => regenerateQueriesAndDiscover()}
              disabled={discoveryBusy}
              class="rounded-md bg-surface-raised px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-hover disabled:opacity-50"
              data-testid="regenerate-queries"
              >Regenerate queries</button
            >
          {/if}
          <button
            onclick={() => runDiscovery()}
            disabled={discoveryBusy}
            class="rounded-md bg-accent-muted px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-50"
            data-testid="go-deeper"
            >{discoveryBusy ? "Searching…" : "Go deeper"}</button
          >
        </div>
      </div>
      <p class="text-xs text-ink-faint">
        Winnow turns this profile into YouTube searches and vets what it finds — new videos and
        creators beyond your subscriptions. Already-seen finds never repeat.
      </p>

      {#if discoveryBusy || $discoveryStatus.phase === "error" || $discoveryStatus.detail}
        <p
          class={`text-sm ${$discoveryStatus.phase === "error" ? "text-danger" : "text-ink-muted"}`}
          data-testid="discovery-status"
          aria-live="polite"
        >
          {$discoveryStatus.detail}
        </p>
      {/if}
      {#each $discoveryStatus.warnings as warning (warning)}
        <p class="rounded-md border border-caution/40 bg-caution/10 px-3 py-2 text-sm text-caution">{warning}</p>
      {/each}

      {#if discoveryVetting > 0}
        <p class="text-xs text-ink-faint" data-testid="discovery-vetting">
          Vetting {discoveryVetting} {discoveryVetting === 1 ? "discovery" : "discoveries"}…
        </p>
      {/if}

      {#if discoveryBrowsable.length > 0}
        <div data-testid="discovery-results">
          {#each discoveryBrowsable as video (video.id)}
            <VideoCard {video} watched={watchedSet.has(video.id)} hideScoreNumber={$collapsed} />
          {/each}
        </div>
      {/if}

      {#if $discoveryTiers.winnowed.length > 0}
        <button
          onclick={() => (showDiscoveryWinnowed = !showDiscoveryWinnowed)}
          class="w-full rounded-md bg-surface-raised px-3 py-2 text-left text-sm text-ink-faint hover:bg-surface-hover"
          data-testid="discovery-winnowed-fold"
        >
          {showDiscoveryWinnowed ? "▾" : "▸"}
          {$discoveryTiers.winnowed.length}
          {$discoveryTiers.winnowed.length === 1 ? "discovery" : "discoveries"} winnowed out — {showDiscoveryWinnowed ? "hide" : "show"}
        </button>
        {#if showDiscoveryWinnowed}
          <div class="mt-2 opacity-70" data-testid="discovery-winnowed">
            {#each $discoveryTiers.winnowed as video (video.id)}
              <VideoCard {video} watched={watchedSet.has(video.id)} hideScoreNumber={$collapsed} />
            {/each}
          </div>
        {/if}
      {/if}
    </section>

    <p class="pt-4 text-center text-xs text-ink-faint">
      That's everything from your subscriptions and recommendations. The page has a bottom.
    </p>
    {/if}
  {/if}
</div>
