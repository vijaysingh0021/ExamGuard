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
  private readonly sensitiveValues: string[];

  constructor(host: string, port: number, user: string, password: string, private from: string, transporter?: Transporter) {
    this.sensitiveValues = [user, password];
    this.transporter = transporter ?? nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      requireTLS: port === 587,
      auth: { user, pass: password },
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async verify() {
    try {
      await this.transporter.verify();
    } catch (error) {
      logSmtpFailure('verification', error, undefined, this.sensitiveValues);
      throw new Error('SMTP connectivity or authentication verification failed');
    }
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
      logSmtpFailure('delivery', error, message.text, this.sensitiveValues);
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

function logSmtpFailure(operation: 'delivery' | 'verification', error: unknown, messageText?: string, providerSecrets: string[] = []) {
  const failure = error !== null && typeof error === 'object'
    ? error as { code?: unknown; responseCode?: unknown; response?: unknown }
    : {};
  const secretValues = Object.entries(process.env)
    .filter(([name, value]) => value && /(?:PASS|SECRET|TOKEN|API[_-]?KEY|CREDENTIAL)/i.test(name))
    .map(([, value]) => value as string)
    .concat(providerSecrets);
  if (messageText) {
    secretValues.push(messageText);
    secretValues.push(...(messageText.match(/[A-Za-z0-9+/_=-]{8,}/g) ?? []));
  }
  for (const secret of [...secretValues]) {
    if (secret) secretValues.push(Buffer.from(secret).toString('base64'), encodeURIComponent(secret));
  }
  const redact = (value: string) => {
    let safe = value;
    for (const secret of secretValues) safe = safe.split(secret).join('[REDACTED]');
    return safe.replace(/\b\d{6}\b/g, '[REDACTED]')
      .replace(/(password|pass|api[-_ ]?key|token|secret)\s*[:=]\s*([^\s,;]+)/gi, '$1=[REDACTED]');
  };
  const response = typeof failure.response === 'string' ? redact(failure.response).slice(0, 1000) : undefined;
  console.error('email.smtp.failure', {
    operation,
    code: typeof failure.code === 'string' ? failure.code : undefined,
    responseCode: typeof failure.responseCode === 'number' ? failure.responseCode : undefined,
    response,
  });
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

  async verify() {
    const response = await this.request('https://api.brevo.com/v3/senders', 'verification');
    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) throw new EmailTransientError(`Brevo returned ${response.status}`);
      throw new EmailPermanentError(`Brevo rejected the verification request (${response.status})`);
    }
    const body = await response.json().catch(() => ({})) as { senders?: Array<{ email?: unknown; active?: unknown }> };
    const senderIsActive = body.senders?.some(sender =>
      typeof sender.email === 'string' && sender.email.toLowerCase() === this.sender.email.toLowerCase() && sender.active === true,
    );
    if (!senderIsActive) throw new EmailPermanentError('Configured Brevo sender is not verified and active');
  }

  async send(message: EmailMessage) {
    const response = await this.request('https://api.brevo.com/v3/smtp/email', 'delivery', {
      sender: this.sender,
      to: [{ email: message.to }],
      subject: message.subject,
      textContent: message.text,
    });

    if (response.ok) {
      const body = await response.json().catch(() => ({})) as { messageId?: unknown };
      return { messageId: typeof body.messageId === 'string' ? body.messageId.slice(0, 200) : undefined };
    }
    if (response.status === 429 || response.status >= 500) throw new EmailTransientError(`Brevo returned ${response.status}`);
    throw new EmailPermanentError(`Brevo rejected the message (${response.status})`);
  }

  private async request(url: string, operation: 'delivery' | 'verification', body?: object) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: body ? 'POST' : 'GET',
        signal: controller.signal,
        headers: { 'api-key': this.apiKey, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      console.error('email.brevo.request_failed', { operation, reason: 'network_or_timeout' });
      throw new EmailTransientError('Email provider unreachable or timed out');
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) {
      console.info('email.brevo.response', { operation, status: response.status, ok: true });
    } else {
      console.error('email.brevo.response', {
        operation,
        status: response.status,
        ok: false,
        error: await sanitizedBrevoError(response, this.apiKey),
      });
    }
    return response;
  }
}

async function sanitizedBrevoError(response: Response, apiKey: string) {
  const raw = await response.text().catch(() => '');
  let body: unknown;
  try { body = JSON.parse(raw); } catch { body = null; }
  if (!body || typeof body !== 'object') return { message: 'Brevo returned a non-JSON error response' };

  const error = body as { code?: unknown; message?: unknown };
  const code = typeof error.code === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(error.code) ? error.code : undefined;
  if (typeof error.message !== 'string') return { ...(code ? { code } : {}) };
  const escapedKey = apiKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const message = (apiKey ? error.message.replace(new RegExp(escapedKey, 'gi'), '[REDACTED]') : error.message)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(/\b\d{6}\b/g, '[REDACTED]')
    .replace(/(password|pass|api[-_ ]?key|token|secret)\s*[:=]\s*([^\s,;]+)/gi, '$1=[REDACTED]')
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '[REDACTED]')
    .replace(/https?:\/\/\S+/gi, '[REDACTED_URL]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 300);
  return { ...(code ? { code } : {}), message };
}

const isLocalHttp = (u: URL) => u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
export function emailProviderFromEnv(env: Record<string, string | undefined> = process.env): EmailProvider | null {
  const from = env.MAIL_FROM?.trim() || env.EMAIL_FROM?.trim();
  if (!from) return null;
  if (env.EMAIL_PROVIDER === 'smtp') {
    const port = Number(env.SMTP_PORT);
    if (!env.SMTP_HOST || !Number.isInteger(port) || port < 1 || port > 65535 || !env.SMTP_USER || !env.SMTP_PASS || !parseBrevoSender(from)) return null;
    return new SmtpEmailProvider(env.SMTP_HOST, port, env.SMTP_USER, env.SMTP_PASS, from);
  }
  if (env.EMAIL_PROVIDER === 'brevo') {
    const sender = parseBrevoSender(from);
    const apiKey = env.EMAIL_API_KEY?.trim();
    return apiKey && sender ? new BrevoEmailProvider(apiKey, sender) : null;
  }
  if (env.EMAIL_PROVIDER !== 'webhook' || !env.EMAIL_URL) return null;
  try { const u = new URL(env.EMAIL_URL); if (u.protocol !== 'https:' && !isLocalHttp(u)) return null; } catch { return null; }
  return new WebhookEmailProvider(env.EMAIL_URL, from, env.EMAIL_API_KEY);
}

export function emailProviderStatus(env: Record<string, string | undefined> = process.env) {
  const provider = emailProviderFromEnv(env);
  const missing: string[] = [];
  if (!env.MAIL_FROM?.trim() && !env.EMAIL_FROM?.trim()) missing.push('MAIL_FROM');
  if (env.EMAIL_PROVIDER === 'brevo' && !env.EMAIL_API_KEY?.trim()) missing.push('EMAIL_API_KEY');
  return {
    provider: provider?.name ?? env.EMAIL_PROVIDER ?? 'unconfigured',
    configured: provider !== null,
    missing,
    ...(provider === null && missing.length === 0 ? { configurationIssue: 'invalid_or_unsupported_configuration' } : {}),
  };
}
