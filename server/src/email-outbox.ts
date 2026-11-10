import crypto from 'node:crypto';
import { backoffMs, safeJobError } from './jobs.js';
import { EmailPermanentError, type EmailProvider } from './email.js';

/**
 * Durable email outbox. Rows are unique by dedupeKey (`notification:<id>`), so restarts and repeated sweeps never create a
 * second email. Sending claims a row with a conditional update, passes the dedupeKey as the provider idempotency key, and
 * recovers rows stuck in `sending` after a crash. Password-reset emails are deliberately NOT routed through here: their
 * links are secrets and are sent directly (mailer.ts) rather than stored.
 */
type Delegate = Record<string, (args?: any) => Promise<any>>;
export interface OutboxDb { notification: Delegate; emailOutbox: Delegate; emailPreference: Delegate }
export interface EmailDeps { db: OutboxDb; provider: EmailProvider | null; now?: () => Date; unsubscribeSecret?: string; apiBaseUrl?: string; appBaseUrl?: string }

export type EmailCategory = 'exam' | 'admin';
/** Only these notification types are ever emailed. */
export const EMAILED_TYPES: Record<string, EmailCategory> = { exam_reminder: 'exam', attempt_auto_submitted: 'exam', result_published: 'exam', explanation_requested: 'exam', explanation_follow_up: 'exam', explanation_decision: 'exam', explanation_response_received: 'admin', review_reminder: 'admin', retention_due: 'admin' };
const PREF_FIELD: Record<EmailCategory, 'examEmails' | 'adminEmails'> = { exam: 'examEmails', admin: 'adminEmails' };
const FANOUT_WINDOW_MS = 48 * 3_600_000;
const STUCK_SENDING_MS = 10 * 60_000;

export const signUnsubscribe = (userId: string, category: EmailCategory, secret: string) =>
  `${userId}.${category}.${crypto.createHmac('sha256', `examguard-unsubscribe-v1:${secret}`).update(`${userId}.${category}`).digest('base64url')}`;
export function verifyUnsubscribe(token: string, secret: string): { userId: string; category: EmailCategory } | null {
  const [userId, category, sig, extra] = token.split('.');
  if (!userId || !sig || extra !== undefined || (category !== 'exam' && category !== 'admin')) return null;
  const expected = signUnsubscribe(userId, category, secret).split('.')[2];
  const a = Buffer.from(sig), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? { userId, category } : null;
}

export function composeEmail(n: { title: string; body: string }, opts: { appBaseUrl?: string; unsubscribeUrl?: string }) {
  return [n.body, '', opts.appBaseUrl ? `Open ExamGuard: ${opts.appBaseUrl.replace(/\/$/, '')}/app` : '', '', '—', 'You receive this because of your ExamGuard account. This message is an automated notice, not a finding about anyone.', opts.unsubscribeUrl ? `Stop these emails: ${opts.unsubscribeUrl}` : 'You can manage email preferences from the notification bell in ExamGuard.'].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}

const expiryFor = (n: { type: string; createdAt: Date; metadata?: any }) => {
  const startsAt = n.type === 'exam_reminder' && n.metadata?.startsAt ? new Date(n.metadata.startsAt) : null;
  return startsAt && !Number.isNaN(+startsAt) ? startsAt : new Date(n.createdAt.getTime() + FANOUT_WINDOW_MS); // a reminder is useless once the exam has started
};

/** Turn recent, allow-listed notifications into outbox rows for users who have not opted out. No-op without a provider. */
export async function fanoutNotificationEmails({ db, provider, now = () => new Date(), unsubscribeSecret, apiBaseUrl, appBaseUrl }: EmailDeps) {
  if (!provider) return { skipped: 'not_configured' as const, queued: 0 };
  const at = now();
  const items: Array<{ id: string; organizationId: string; userId: string; type: string; title: string; body: string; createdAt: Date; metadata?: any; user: { email: string } }> = await db.notification.findMany({
    where: { type: { in: Object.keys(EMAILED_TYPES) }, createdAt: { gte: new Date(at.getTime() - FANOUT_WINDOW_MS) } }, orderBy: { createdAt: 'asc' }, take: 200,
    select: { id: true, organizationId: true, userId: true, type: true, title: true, body: true, createdAt: true, metadata: true, user: { select: { email: true } } } });
  if (!items.length) return { queued: 0 };
  const prefs: Array<{ userId: string; examEmails: boolean; adminEmails: boolean }> = await db.emailPreference.findMany({ where: { userId: { in: [...new Set(items.map(i => i.userId))] } } });
  const prefOf = new Map(prefs.map(p => [p.userId, p]));
  const data = items.filter(i => i.type in EMAILED_TYPES && i.user?.email && prefOf.get(i.userId)?.[PREF_FIELD[EMAILED_TYPES[i.type]]] !== false).map(i => {
    const category = EMAILED_TYPES[i.type];
    const unsubscribeUrl = unsubscribeSecret && apiBaseUrl ? `${apiBaseUrl.replace(/\/$/, '')}/api/email/unsubscribe?token=${encodeURIComponent(signUnsubscribe(i.userId, category, unsubscribeSecret))}` : undefined;
    return { dedupeKey: `notification:${i.id}`, organizationId: i.organizationId, userId: i.userId, toEmail: i.user.email, template: i.type, category, subject: i.title.slice(0, 200), bodyText: composeEmail(i, { appBaseUrl, unsubscribeUrl }), expiresAt: expiryFor(i), nextAttemptAt: at };
  });
  if (!data.length) return { queued: 0 };
  const res = await db.emailOutbox.createMany({ data, skipDuplicates: true });
  return { queued: res.count as number };
}

/** Send due emails. Safe to run on several instances: each row is claimed with a conditional update. */
export async function sendQueuedEmails({ db, provider, now = () => new Date() }: EmailDeps) {
  if (!provider) return { skipped: 'not_configured' as const, sent: 0, retried: 0, failed: 0, expired: 0, suppressed: 0 };
  const at = now(); const s = { sent: 0, retried: 0, failed: 0, expired: 0, suppressed: 0 };
  await db.emailOutbox.updateMany({ where: { status: 'sending', updatedAt: { lt: new Date(at.getTime() - STUCK_SENDING_MS) } }, data: { status: 'queued' } });
  const rows: Array<{ id: string; attempts: number; maxAttempts: number; toEmail: string; subject: string; bodyText: string; dedupeKey: string; userId: string | null; category: EmailCategory; expiresAt: Date | null }> = await db.emailOutbox.findMany({ where: { status: 'queued', nextAttemptAt: { lte: at } }, orderBy: { nextAttemptAt: 'asc' }, take: 20 });
  for (const row of rows) {
    const claimed = await db.emailOutbox.updateMany({ where: { id: row.id, status: 'queued', attempts: row.attempts }, data: { status: 'sending', attempts: { increment: 1 } } });
    if (claimed.count !== 1) continue; // another worker has it
    const attempts = row.attempts + 1;
    if (row.expiresAt && row.expiresAt <= at) { await db.emailOutbox.updateMany({ where: { id: row.id }, data: { status: 'expired' } }); s.expired++; continue; }
    const pref = row.userId ? await db.emailPreference.findUnique({ where: { userId: row.userId } }) : null; // re-checked at send time
    if (pref && pref[PREF_FIELD[row.category]] === false) { await db.emailOutbox.updateMany({ where: { id: row.id }, data: { status: 'suppressed' } }); s.suppressed++; continue; }
    try {
      const r = await provider.send({ to: row.toEmail, subject: row.subject, text: row.bodyText, idempotencyKey: row.dedupeKey });
      await db.emailOutbox.updateMany({ where: { id: row.id }, data: { status: 'sent', sentAt: at, providerMessageId: r.messageId ?? null, lastError: null } }); s.sent++;
    } catch (error) {
      const give = error instanceof EmailPermanentError || attempts >= row.maxAttempts;
      await db.emailOutbox.updateMany({ where: { id: row.id }, data: give ? { status: 'failed', lastError: safeJobError(error) } : { status: 'queued', nextAttemptAt: new Date(at.getTime() + backoffMs(attempts, 30_000, 3_600_000)), lastError: safeJobError(error) } });
      s[give ? 'failed' : 'retried']++;
    }
  }
  return s;
}
