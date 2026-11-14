import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

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

export class SmtpEmailProvider implements EmailProvider {
  name = 'smtp';
  private transporter: Transporter;

  constructor(host: string, port: number, user: string, password: string, private from: string, transporter?: Transporter) {
    this.transporter = transporter ?? nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass: password },
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async send(message: EmailMessage) {
    try {
      const result = await this.transporter.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        headers: { 'X-ExamGuard-Idempotency-Key': message.idempotencyKey },
      });
      return { messageId: typeof result.messageId === 'string' ? result.messageId.slice(0, 200) : undefined };
    } catch (error) {
      const failure = error as { code?: unknown; responseCode?: unknown };
      const code = typeof failure.code === 'string' ? failure.code : '';
      const responseCode = typeof failure.responseCode === 'number' ? failure.responseCode : 0;
      if (['ETIMEDOUT', 'ECONNECTION', 'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENOTFOUND', 'ESOCKET', 'EAI_AGAIN'].includes(code) || (responseCode >= 400 && responseCode < 500)) {
        throw new EmailTransientError('SMTP delivery temporarily failed');
      }
      throw new EmailPermanentError('SMTP server rejected the message');
    }
  }
}

type BrevoSender = { email: string; name?: string };

function parseBrevoSender(value: string): BrevoSender | null {
  const displayName = /^\s*"?([^"<]*)"?\s*<([^<>]+)>\s*$/.exec(value);
  const email = displayName?.[2]?.trim() ?? value.trim();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) return null;
  const name = displayName?.[1]?.trim();
  return { email, ...(name ? { name } : {}) };
}

export class BrevoEmailProvider implements EmailProvider {
  name = 'brevo';

  constructor(private apiKey: string, private sender: BrevoSender, private timeoutMs = 15_000, private fetchImpl: typeof fetch = fetch) {}

  async send(message: EmailMessage) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'api-key': this.apiKey },
        body: JSON.stringify({
          sender: this.sender,
          to: [{ email: message.to }],
          subject: message.subject,
          textContent: message.text,
        }),
      });
    } catch {
      throw new EmailTransientError('Email provider unreachable or timed out');
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) {
      const body = await response.json().catch(() => ({})) as { messageId?: unknown };
      return { messageId: typeof body.messageId === 'string' ? body.messageId.slice(0, 200) : undefined };
    }
    if (response.status === 429 || response.status >= 500) throw new EmailTransientError(`Email provider returned ${response.status}`);
    throw new EmailPermanentError(`Email provider rejected the message (${response.status})`);
  }
}

const isLocalHttp = (u: URL) => u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
export function emailProviderFromEnv(env: Record<string, string | undefined> = process.env): EmailProvider | null {
  const from = env.MAIL_FROM || env.EMAIL_FROM;
  if (!from) return null;
  if (env.EMAIL_PROVIDER === 'smtp') {
    const port = Number(env.SMTP_PORT);
    if (!env.SMTP_HOST || !Number.isInteger(port) || port < 1 || port > 65535 || !env.SMTP_USER || !env.SMTP_PASS) return null;
    return new SmtpEmailProvider(env.SMTP_HOST, port, env.SMTP_USER, env.SMTP_PASS, from);
  }
  if (env.EMAIL_PROVIDER === 'brevo') {
    const sender = parseBrevoSender(from);
    return env.EMAIL_API_KEY && sender ? new BrevoEmailProvider(env.EMAIL_API_KEY, sender) : null;
  }
  if (env.EMAIL_PROVIDER !== 'webhook' || !env.EMAIL_URL) return null;
  try { const u = new URL(env.EMAIL_URL); if (u.protocol !== 'https:' && !isLocalHttp(u)) return null; } catch { return null; }
  return new WebhookEmailProvider(env.EMAIL_URL, from, env.EMAIL_API_KEY);
}
