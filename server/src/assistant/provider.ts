/** Provider boundary. Fail-closed: without configuration the assistant answers from the help articles only. */
export interface AssistantProvider { name: string; complete(system: string, user: string, opts: { maxTokens: number }): Promise<string> }
export class ProviderError extends Error {}

export const isLocalEndpoint = (url: string) => {
  try { return ['localhost', '127.0.0.1', '[::1]', 'host.docker.internal'].includes(new URL(url).hostname); } catch { return false; }
};

export class OpenAICompatibleProvider implements AssistantProvider {
  name = 'openai-compatible';
  constructor(private baseUrl: string, private model: string, private apiKey?: string, private timeoutMs = 20_000, private retries = 1, private fetchImpl: typeof fetch = fetch) {}
  async complete(system: string, user: string, { maxTokens }: { maxTokens: number }) {
    let last: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(`${this.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
          method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) },
          body: JSON.stringify({ model: this.model, max_tokens: maxTokens, temperature: 0.2, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const text = ((await res.json()) as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content;
        if (typeof text !== 'string' || !text.trim()) throw new Error('empty completion');
        return text;
      } catch (error) { last = error; } finally { clearTimeout(timer); }
    }
    throw new ProviderError(`Provider unavailable: ${last instanceof Error ? last.message : 'unknown'}`);
  }
}

/** Non-local endpoints also need ASSISTANT_EXTERNAL_DATA_POLICY_APPROVED=true because prompts may carry exam context. */
export function providerFromEnv(env: Record<string, string | undefined> = process.env): AssistantProvider | null {
  const url = env.ASSISTANT_PROVIDER_URL, model = env.ASSISTANT_MODEL;
  if (!url || !model) return null;
  if (!isLocalEndpoint(url) && env.ASSISTANT_EXTERNAL_DATA_POLICY_APPROVED !== 'true') return null;
  return new OpenAICompatibleProvider(url, model, env.ASSISTANT_API_KEY);
}
