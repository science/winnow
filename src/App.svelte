<script lang="ts">
  import { route } from "./lib/router";
  import { isConfigured, profile, settings, settingsReady } from "./stores/settingsStore";
  import Feed from "./components/Feed.svelte";
  import Watch from "./components/Watch.svelte";
  import Settings from "./components/Settings.svelte";
  import Onboarding from "./components/Onboarding.svelte";

  let ready = $state(false);
  void settingsReady.then(() => (ready = true));

  const configured = $derived(isConfigured($settings, $profile));
</script>

<div class="mx-auto min-h-screen max-w-5xl px-4 pb-16">
  <header class="flex items-center justify-between py-5">
    <a href="#/" class="flex items-baseline gap-2 no-underline">
      <span class="text-2xl font-semibold tracking-tight text-ink">winnow</span>
      <span class="text-sm text-ink-faint">watch what matters</span>
    </a>
    <nav class="flex items-center gap-4 text-sm">
      <a href="#/" class="text-ink-muted hover:text-ink">Feed</a>
      <a href="#/settings" class="text-ink-muted hover:text-ink">Settings</a>
    </nav>
  </header>

  <main>
    {#if !ready}
      <!-- storage load is near-instant; avoid flashing onboarding -->
    {:else if $route.name === "watch"}
      <Watch videoId={$route.videoId} />
    {:else if $route.name === "settings"}
      <Settings />
    {:else if !configured}
      <Onboarding />
    {:else}
      <Feed />
    {/if}
  </main>

  <footer class="mt-16 border-t border-surface-hover pt-4 text-xs text-ink-faint">
    winnow {__PKG_VERSION__} ({__GIT_HASH__}) — your data stays in your browser
  </footer>
</div>
