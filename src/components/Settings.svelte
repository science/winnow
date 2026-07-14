<script lang="ts">
  import { applyKeyChange, profile, settings } from "../stores/settingsStore";
  import { KEYS, storageRemove } from "../lib/storage";
  import { scores } from "../stores/feedStore";
  import { feedback } from "../stores/feedbackStore";
  import { scoreFeed } from "../services/scoring/scorer";
  import {
    MIN_VOTES_FOR_SUGGESTION,
    suggestProfileUpdate,
    type ProfileSuggestion,
  } from "../services/scoring/profileSuggest";
  import { lastCaptures } from "../services/youtube/ytPage";
  import { lastTranscriptCapture } from "../services/youtube/transcripts";
  import { fetchProviderModels } from "../services/scoring/modelCatalog";
  import { modelCatalog } from "../stores/modelCatalogStore";
  import { isDemoMode } from "../services/youtube/feedSource";
  import type { Provider } from "../lib/types";

  let saved = $state(false);
  let captureMessage = $state("");
  let suggesting = $state(false);
  let suggestion = $state<ProfileSuggestion | null>(null);
  let suggestError = $state("");
  let refreshingModels = $state(false);
  let modelsError = $state("");

  const voteCount = $derived(Object.keys($feedback).length);
  const demo = isDemoMode();

  // The current selection always renders, even when the catalog hasn't been
  // fetched (fresh install) or no longer lists it (retired model).
  const anthropicOptions = $derived(
    $modelCatalog.anthropic.includes($settings.anthropicModel)
      ? $modelCatalog.anthropic
      : [$settings.anthropicModel, ...$modelCatalog.anthropic],
  );
  const openaiOptions = $derived(
    $modelCatalog.openai.includes($settings.openaiModel)
      ? $modelCatalog.openai
      : [$settings.openaiModel, ...$modelCatalog.openai],
  );

  function setModel(provider: Provider, model: string): void {
    settings.update((s) =>
      provider === "anthropic" ? { ...s, anthropicModel: model } : { ...s, openaiModel: model },
    );
    flashSaved();
  }

  async function refreshModels(): Promise<void> {
    refreshingModels = true;
    modelsError = "";
    try {
      const [anthropic, openai] = await Promise.all([
        $settings.anthropicApiKey
          ? fetchProviderModels("anthropic", $settings.anthropicApiKey)
          : Promise.resolve<string[] | null>(null),
        $settings.openaiApiKey
          ? fetchProviderModels("openai", $settings.openaiApiKey)
          : Promise.resolve<string[] | null>(null),
      ]);
      modelCatalog.update((c) => ({
        anthropic: anthropic ?? c.anthropic,
        openai: openai ?? c.openai,
        fetchedAt: Date.now(),
      }));
    } catch (err) {
      modelsError = err instanceof Error ? err.message : "Model list refresh failed.";
    } finally {
      refreshingModels = false;
    }
  }

  async function runSuggest(): Promise<void> {
    suggesting = true;
    suggestError = "";
    suggestion = null;
    try {
      suggestion = await suggestProfileUpdate();
    } catch (err) {
      suggestError = err instanceof Error ? err.message : "Suggestion failed.";
    } finally {
      suggesting = false;
    }
  }

  function applySuggestion(): void {
    const s = suggestion;
    if (!s) return;
    profile.update((p) => ({ ...p, moreOf: s.moreOf, lessOf: s.lessOf, updatedAt: Date.now() }));
    suggestion = null;
    flashSaved();
    // The profileHash change makes this a clean full re-score — identical
    // semantics to editing the profile by hand.
    void scoreFeed();
  }

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
    const transcript = lastTranscriptCapture.current;
    if (parts.length === 0 && !transcript) {
      captureMessage = "Nothing captured yet — refresh the feed first.";
      return;
    }
    const bundle: Record<string, unknown> = Object.fromEntries(
      parts.map(([k, v]) => [k, JSON.parse(v ?? "null")]),
    );
    if (transcript) {
      bundle["transcript"] = {
        videoId: transcript.videoId,
        playerResponse: safeParse(transcript.playerResponseRaw),
        ytInitialData: safeParse(transcript.ytInitialDataRaw),
        innertubeResponse: safeParse(transcript.innertubeResponseRaw),
      };
    }
    const captured = [...parts.map(([k]) => k), ...(transcript ? ["transcript"] : [])];
    await navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
    captureMessage = `Copied raw captures for: ${captured.join(", ")}. Paste into a file for parser fixtures.`;
  }

  function safeParse(raw: string | null): unknown {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
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
      Editing the profile re-scores your whole feed on the next refresh (a few cents with a cheap
      model). Your Good pick / Not for me votes steer future scoring automatically; “Re-score
      everything” below applies them to the whole feed at once.
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
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label class="block text-sm">
        <span class="mb-1 block font-medium text-ink-muted">Anthropic model</span>
        <select
          class="w-full rounded-md border border-surface-hover bg-surface-raised p-3 text-sm"
          value={$settings.anthropicModel}
          onchange={(e) => setModel("anthropic", e.currentTarget.value)}
        >
          {#each anthropicOptions as id (id)}
            <option value={id}>{id}</option>
          {/each}
        </select>
      </label>
      <label class="block text-sm">
        <span class="mb-1 block font-medium text-ink-muted">OpenAI model</span>
        <select
          class="w-full rounded-md border border-surface-hover bg-surface-raised p-3 text-sm"
          value={$settings.openaiModel}
          onchange={(e) => setModel("openai", e.currentTarget.value)}
        >
          {#each openaiOptions as id (id)}
            <option value={id}>{id}</option>
          {/each}
        </select>
      </label>
    </div>
    <button
      onclick={refreshModels}
      disabled={demo || refreshingModels || (!$settings.anthropicApiKey && !$settings.openaiApiKey)}
      class="rounded-md bg-surface-raised px-4 py-2 text-sm text-ink hover:bg-surface-hover disabled:opacity-50"
      data-testid="refresh-models"
      title="Fetches the current model list from each provider you have a key for"
      >{refreshingModels ? "Refreshing model list…" : "Refresh model list"}</button
    >
    {#if modelsError}<p class="text-xs text-danger">{modelsError}</p>{/if}
    <p class="text-xs text-ink-faint">
      Keys live only in this browser's extension storage and are sent only to the provider you chose.
      Changing the scoring model re-scores the feed (cached scores are per-model).
    </p>
    {#if saved}<p class="text-xs text-accent">Saved.</p>{/if}
  </section>

  <section class="space-y-3">
    <h2 class="text-lg font-medium">Feedback</h2>
    <p class="text-sm text-ink-muted" data-testid="feedback-count">
      You've rated {voteCount} {voteCount === 1 ? "video" : "videos"} (Good pick / Not for me).
    </p>
    <button
      onclick={runSuggest}
      disabled={voteCount < MIN_VOTES_FOR_SUGGESTION || suggesting}
      class="rounded-md bg-surface-raised px-4 py-2 text-sm text-ink hover:bg-surface-hover disabled:opacity-50"
      data-testid="suggest-profile"
      >Suggest profile updates from my feedback</button
    >
    {#if voteCount < MIN_VOTES_FOR_SUGGESTION}
      <p class="text-xs text-ink-faint">
        Rate at least {MIN_VOTES_FOR_SUGGESTION} videos in the feed to unlock suggestions.
      </p>
    {/if}
    {#if suggesting}<p class="text-xs text-ink-muted">Analyzing your rated videos…</p>{/if}
    {#if suggestError}<p class="text-xs text-danger">{suggestError}</p>{/if}
    {#if suggestion}
      <div
        class="space-y-3 rounded-md border border-accent/40 bg-surface-raised p-4"
        data-testid="profile-suggestion"
      >
        <div>
          <p class="text-xs font-medium uppercase tracking-wide text-ink-faint">Suggested — More of this</p>
          <p class="mt-1 whitespace-pre-wrap text-sm text-ink">{suggestion.moreOf}</p>
        </div>
        <div>
          <p class="text-xs font-medium uppercase tracking-wide text-ink-faint">Suggested — Less of this</p>
          <p class="mt-1 whitespace-pre-wrap text-sm text-ink">{suggestion.lessOf}</p>
        </div>
        <p class="text-xs italic text-ink-muted">{suggestion.rationale}</p>
        <div class="flex gap-2">
          <button
            onclick={applySuggestion}
            class="rounded-md bg-accent-muted px-4 py-2 text-sm text-white hover:opacity-90"
            data-testid="apply-suggestion">Apply (re-scores the feed)</button
          >
          <button
            onclick={() => (suggestion = null)}
            class="rounded-md bg-surface-raised px-4 py-2 text-sm text-ink hover:bg-surface-hover"
            data-testid="dismiss-suggestion">Dismiss</button
          >
        </div>
      </div>
    {/if}
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
