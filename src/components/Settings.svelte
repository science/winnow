<script lang="ts">
  import { applyKeyChange, profile, settings } from "../stores/settingsStore";
  import { KEYS, storageRemove } from "../lib/storage";
  import { scores } from "../stores/feedStore";
  import { scoreFeed } from "../services/scoring/scorer";
  import { lastCaptures } from "../services/youtube/ytPage";
  import type { Provider } from "../lib/types";

  let saved = $state(false);
  let captureMessage = $state("");

  function setProvider(p: Provider): void {
    settings.update((s) => ({ ...s, provider: p }));
  }

  function flashSaved(): void {
    saved = true;
    setTimeout(() => (saved = false), 1500);
  }

  async function rescoreAll(): Promise<void> {
    await storageRemove(KEYS.scores);
    scores.set({});
    await scoreFeed();
  }

  async function copyFixture(): Promise<void> {
    const parts = Object.entries(lastCaptures);
    if (parts.length === 0) {
      captureMessage = "Nothing captured yet — refresh the feed first.";
      return;
    }
    const bundle = Object.fromEntries(parts.map(([k, v]) => [k, JSON.parse(v ?? "null")]));
    await navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
    captureMessage = `Copied raw ytInitialData for: ${parts.map(([k]) => k).join(", ")}. Paste into a file for parser fixtures.`;
  }
</script>

<div class="mx-auto max-w-2xl space-y-8">
  <section class="space-y-3">
    <h2 class="text-lg font-medium">Interest profile</h2>
    <p class="text-sm text-ink-muted">
      The AI scores every video against this. Be concrete — channels, topics, formats, moods.
    </p>
    <label class="block text-sm">
      <span class="mb-1 block font-medium text-ink-muted">More of this</span>
      <textarea
        rows="4"
        class="w-full rounded-md border border-surface-hover bg-surface-raised p-3 text-ink placeholder:text-ink-faint"
        placeholder="e.g. deep technical dives, woodworking process videos, long-form science explainers with real math…"
        value={$profile.moreOf}
        onchange={(e) => {
          profile.update((p) => ({ ...p, moreOf: e.currentTarget.value, updatedAt: Date.now() }));
          flashSaved();
        }}
      ></textarea>
    </label>
    <label class="block text-sm">
      <span class="mb-1 block font-medium text-ink-muted">Less of this</span>
      <textarea
        rows="4"
        class="w-full rounded-md border border-surface-hover bg-surface-raised p-3 text-ink placeholder:text-ink-faint"
        placeholder="e.g. drama/beef videos, reaction content, 'I tried X for 30 days', anything with a shocked face thumbnail…"
        value={$profile.lessOf}
        onchange={(e) => {
          profile.update((p) => ({ ...p, lessOf: e.currentTarget.value, updatedAt: Date.now() }));
          flashSaved();
        }}
      ></textarea>
    </label>
    <p class="text-xs text-ink-faint">
      Editing the profile re-scores your whole feed on the next refresh (a few cents with a cheap model).
    </p>
  </section>

  <section class="space-y-3">
    <h2 class="text-lg font-medium">AI provider</h2>
    <div class="flex gap-2" role="radiogroup" aria-label="AI provider">
      {#each [["anthropic", "Anthropic"], ["openai", "OpenAI"]] as [value, label] (value)}
        <button
          role="radio"
          aria-checked={$settings.provider === value}
          onclick={() => setProvider(value as Provider)}
          class={`rounded-md px-4 py-2 text-sm ${$settings.provider === value ? "bg-accent-muted text-white" : "bg-surface-raised text-ink-muted hover:bg-surface-hover"}`}
          >{label}</button
        >
      {/each}
    </div>
    <label class="block text-sm">
      <span class="mb-1 block font-medium text-ink-muted">Anthropic API key</span>
      <input
        type="password"
        autocomplete="off"
        class="w-full rounded-md border border-surface-hover bg-surface-raised p-3 font-mono text-sm"
        placeholder="sk-ant-…"
        value={$settings.anthropicApiKey ?? ""}
        onchange={(e) => {
          settings.update((s) => applyKeyChange(s, "anthropic", e.currentTarget.value.trim() || null));
          flashSaved();
        }}
      />
    </label>
    <label class="block text-sm">
      <span class="mb-1 block font-medium text-ink-muted">OpenAI API key</span>
      <input
        type="password"
        autocomplete="off"
        class="w-full rounded-md border border-surface-hover bg-surface-raised p-3 font-mono text-sm"
        placeholder="sk-…"
        value={$settings.openaiApiKey ?? ""}
        onchange={(e) => {
          settings.update((s) => applyKeyChange(s, "openai", e.currentTarget.value.trim() || null));
          flashSaved();
        }}
      />
    </label>
    <p class="text-xs text-ink-faint">
      Keys live only in this browser's extension storage and are sent only to the provider you chose.
    </p>
    {#if saved}<p class="text-xs text-accent">Saved.</p>{/if}
  </section>

  <section class="space-y-3">
    <h2 class="text-lg font-medium">Maintenance</h2>
    <div class="flex flex-wrap gap-2">
      <button
        onclick={rescoreAll}
        class="rounded-md bg-surface-raised px-4 py-2 text-sm text-ink hover:bg-surface-hover"
        >Re-score everything</button
      >
      <button
        onclick={copyFixture}
        class="rounded-md bg-surface-raised px-4 py-2 text-sm text-ink hover:bg-surface-hover"
        title="Copies the raw ytInitialData from the last feed fetch, for parser test fixtures"
        >Copy debug fixture</button
      >
    </div>
    {#if captureMessage}<p class="text-xs text-ink-muted">{captureMessage}</p>{/if}
  </section>
</div>
