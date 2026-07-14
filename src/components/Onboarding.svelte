<script lang="ts">
  // First-run flow: no key or empty profile ⇒ App routes here instead of
  // the feed. It's just Settings with a welcome, so state lives in one place.
  // The moment config completes, App swaps this view for the feed — so the
  // footer's only job is saying what's still missing, visibly.
  import Settings from "./Settings.svelte";
  import { missingConfig, profile, settings } from "../stores/settingsStore";

  const missing = $derived(missingConfig($settings, $profile));
</script>

<div class="mx-auto max-w-2xl space-y-8" data-testid="onboarding">
  <section class="space-y-3 rounded-lg bg-surface-raised p-6">
    <h1 class="text-xl font-semibold">Welcome to winnow</h1>
    <p class="text-sm leading-relaxed text-ink-muted">
      YouTube's feed optimizes for your attention. Winnow optimizes for your
      <em>satisfaction</em> — an AI reads your subscriptions and recommendations,
      scores every video against what you actually want, and quietly folds away the bait.
    </p>
    <ol class="list-inside list-decimal space-y-1 text-sm text-ink-muted">
      <li>Make sure you're signed in to <a href="https://www.youtube.com" target="_blank" rel="noreferrer" class="text-accent">youtube.com</a> in this browser.</li>
      <li>Paste an API key from <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" class="text-accent">Anthropic</a> or <a href="https://platform.openai.com" target="_blank" rel="noreferrer" class="text-accent">OpenAI</a> below.</li>
      <li>Describe what you want more — and less — of.</li>
    </ol>
    <p class="text-xs text-ink-faint">
      Everything stays in your browser. No winnow server, no telemetry.
    </p>
  </section>

  <Settings />

  <div class="text-center">
    {#if missing.length > 0}
      <p
        class="rounded-md border border-caution/40 bg-caution/10 px-4 py-3 text-sm text-caution"
        data-testid="onboarding-missing"
      >
        Your feed opens automatically once winnow has {missing.join(" and ")}.
      </p>
    {/if}
  </div>
</div>
