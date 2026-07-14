<script lang="ts">
  import type { ScoredVideo, Vote } from "../lib/types";
  import { feedback, toggleVote } from "../stores/feedbackStore";

  let { video }: { video: ScoredVideo } = $props();

  const current = $derived($feedback[video.id]?.vote ?? null);

  // Cards wrap everything in an <a>; a vote must never navigate.
  function vote(v: Vote, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    void toggleVote(video, v);
  }
</script>

<div class="flex gap-1.5" data-testid="vote-buttons">
  <button
    type="button"
    aria-pressed={current === "up"}
    onclick={(e) => vote("up", e)}
    title="Good recommendation — show me more like this"
    class={`rounded px-2 py-0.5 text-[11px] ${
      current === "up"
        ? "bg-accent-muted text-white"
        : "bg-surface-raised text-ink-faint hover:bg-surface-hover hover:text-ink"
    }`}
    data-testid="vote-up">Good pick</button
  >
  <button
    type="button"
    aria-pressed={current === "down"}
    onclick={(e) => vote("down", e)}
    title="Bad recommendation — show me fewer like this"
    class={`rounded px-2 py-0.5 text-[11px] ${
      current === "down"
        ? "bg-danger/70 text-white"
        : "bg-surface-raised text-ink-faint hover:bg-surface-hover hover:text-ink"
    }`}
    data-testid="vote-down">Not for me</button
  >
</div>
