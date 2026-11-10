/** Provider boundary for outbound email. Fail-safe: with no provider configured nothing is sent or queued. */
export interface EmailMessage { to: string; subject: string; text: string; idempotencyKey: string }
export interface EmailProvider { name: string; send(message: EmailMessage): Promise<{ messageId?: string }> }
/** Retrying cannot help (bad address, rejected content, auth failure). */
export class EmailPermanentError extends Error {}
/** Worth retrying later (timeout, network, 429, 5xx). */
export class EmailTransientError extends Error {}

/**
 * JSON-over-HTTPS provider compatible with the existing EMAIL_PROVIDER=webhook setup: POST {from,to,subject,text}.
 * An Idempotency-Key header lets providers that support it drop a duplicate if a worker crashes after sending.
 * Error messages never include the URL or credentials.
 */
export class WebhookEmailProvider implements EmailProvider {
  name = 'webhook';
  constructor(private url: string, private from: string, private apiKey?: string, private timeoutMs = 15_000, private fetchImpl: typeof fetch = fetch) {}
  async send(m: EmailMessage) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(this.url, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': m.idempotencyKey, ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) }, body: JSON.stringify({ from: this.from, to: m.to, subject: m.subject, text: m.text }) });
    } catch { throw new EmailTransientError('Email provider unreachable or timed out'); } finally { clearTimeout(timer); }
    if (res.ok) { const body = await res.json().catch(() => ({})) as { id?: unknown; messageId?: unknown }; const id = body.id ?? body.messageId; return { messageId: typeof id === 'string' ? id.slice(0, 200) : undefined }; }
    if (res.status === 429 || res.status >= 500) throw new EmailTransientError(`Email provider returned ${res.status}`);
    throw new EmailPermanentError(`Email provider rejected the message (${res.status})`);
  }
}

const isLocalHttp = (u: URL) => u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
export function emailProviderFromEnv(env: Record<string, string | undefined> = process.env): EmailProvider | null {
  if (env.EMAIL_PROVIDER !== 'webhook' || !env.EMAIL_URL || !env.EMAIL_FROM) return null;
  try { const u = new URL(env.EMAIL_URL); if (u.protocol !== 'https:' && !isLocalHttp(u)) return null; } catch { return null; }
  return new WebhookEmailProvider(env.EMAIL_URL, env.EMAIL_FROM, env.EMAIL_API_KEY);
}
