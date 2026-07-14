<script lang="ts">
  let {
    score,
    reason,
    clickbait,
    hideNumber = false,
  }: { score?: number; reason?: string; clickbait?: boolean; hideNumber?: boolean } = $props();

  const tone = $derived(
    score === undefined
      ? "bg-surface-hover text-ink-faint"
      : score >= 75
        ? "bg-accent-muted/40 text-accent"
        : score >= 50
          ? "bg-surface-hover text-ink-muted"
          : "bg-surface-hover text-ink-faint",
  );
</script>

<div class="flex items-start gap-2 text-xs">
  {#if score !== undefined && !hideNumber}
    <span class={`shrink-0 rounded px-1.5 py-0.5 font-semibold tabular-nums ${tone}`}>{score}</span>
  {/if}
  {#if clickbait}
    <span
      class="shrink-0 rounded bg-caution/20 px-1.5 py-0.5 font-medium text-caution"
      title="Flagged as clickbait / engagement bait">⚠ bait</span
    >
  {/if}
  {#if reason}
    <span class="text-ink-muted">{reason}</span>
  {/if}
</div>
