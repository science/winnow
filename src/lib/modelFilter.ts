// Pure catalog shaping for the Settings model picker. OpenAI's /v1/models is
// a noisy grab-bag (embeddings, audio, image, moderation…) — only gpt chat
// models are scoreworthy. Anthropic's list is small and all-chat.

const OPENAI_NOISE = /(embed|audio|realtime|tts|whisper|dall-e|image|transcribe|moderation|search|instruct)/;

export function filterOpenaiModels(models: Array<{ id: string; created?: number }>): string[] {
  const seen = new Map<string, number>();
  for (const m of models) {
    if (!/^gpt-/.test(m.id) || OPENAI_NOISE.test(m.id)) continue;
    seen.set(m.id, Math.max(seen.get(m.id) ?? 0, m.created ?? 0));
  }
  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id]) => id);
}

export function sortAnthropicModels(models: Array<{ id: string; created_at?: string }>): string[] {
  const seen = new Map<string, number>();
  for (const m of models) {
    if (!/^claude-/.test(m.id)) continue;
    const ts = m.created_at ? Date.parse(m.created_at) || 0 : 0;
    seen.set(m.id, Math.max(seen.get(m.id) ?? 0, ts));
  }
  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id]) => id);
}
