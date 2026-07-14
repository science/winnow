<script lang="ts">
  let { videoId }: { videoId: string } = $props();
</script>

<section class="rounded-lg bg-surface-raised p-8 text-center">
  <h1 class="text-lg font-medium">Watch view for <code>{videoId}</code></h1>
  <p class="mt-2 text-sm text-ink-muted">Walking skeleton — Phase A.</p>
  <a href="#/" class="mt-4 inline-block text-sm text-accent">← Back to feed</a>
</section>
