import assert from 'node:assert/strict';
import test from 'node:test';
import { EmailPermanentError, EmailTransientError, WebhookEmailProvider, emailProviderFromEnv, type EmailProvider } from '../src/email.js';
import { composeEmail, fanoutNotificationEmails, sendQueuedEmails, signUnsubscribe, verifyUnsubscribe, type OutboxDb } from '../src/email-outbox.js';

const now = new Date('2026-11-07T10:00:00Z'); const at = (ms: number) => new Date(now.getTime() + ms);
type Row = Record<string, any>;
function fake(s: { notifications?: Row[]; prefs?: Row[]; outbox?: Row[] }) {
  const outbox = s.outbox ?? [];
  const db: any = {
    outbox,
    notification: { findMany: async () => s.notifications ?? [] },
    emailPreference: { findMany: async () => s.prefs ?? [], findUnique: async ({ where }: any) => (s.prefs ?? []).find(p => p.userId === where.userId) ?? null },
    emailOutbox: {
      createMany: async ({ data }: any) => { let count = 0; for (const d of data) if (!outbox.some(o => o.dedupeKey === d.dedupeKey)) { outbox.push({ id: `o${outbox.length + 1}`, status: 'queued', attempts: 0, maxAttempts: 5, ...d }); count++; } return { count }; },
      findMany: async () => outbox.filter(o => o.status === 'queued' && o.nextAttemptAt <= now).map(o => ({ ...o })), // copies, like a real database
      updateMany: async ({ where, data }: any) => {
        const hit = outbox.filter(o => (!where.id || o.id === where.id) && (!where.status || o.status === where.status) && (where.attempts === undefined || o.attempts === where.attempts) && (!where.updatedAt || (o.updatedAt && o.updatedAt < where.updatedAt.lt)));
        for (const o of hit) { const { attempts, ...rest } = data; Object.assign(o, rest); if (attempts?.increment) o.attempts += attempts.increment; }
        return { count: hit.length };
      },
    },
  };
  return db as OutboxDb & { outbox: Row[] };
}
const notif = (id: string, over: Row = {}) => ({ id, organizationId: 'org', userId: `u-${id}`, type: 'exam_reminder', title: 'Upcoming exam: Maths', body: 'Starts within the hour.', createdAt: at(-60_000), metadata: { startsAt: at(30 * 60_000) }, user: { email: `${id}@x.test` }, ...over });
const ok = (): EmailProvider & { sent: any[] } => ({ name: 't', sent: [] as any[], async send(m) { this.sent.push(m); return { messageId: 'm1' }; } });

test('without a provider nothing is queued or sent', async () => {
  const db = fake({ notifications: [notif('a')] });
  assert.deepEqual(await fanoutNotificationEmails({ db, provider: null, now: () => now }), { skipped: 'not_configured', queued: 0 });
const result = await sendQueuedEmails({ db, provider: null, now: () => now });
assert.equal('skipped' in result ? result.skipped : undefined, 'not_configured');
 assert.equal(db.outbox.length, 0);
});
test('fan-out is idempotent and respects preferences and the allow-list', async () => {
  const db = fake({ notifications: [notif('a'), notif('b'), notif('c', { type: 'something_private' })], prefs: [{ userId: 'u-b', examEmails: false, adminEmails: true }] });
  const deps = { db, provider: ok(), now: () => now, unsubscribeSecret: 's3cret', apiBaseUrl: 'https://api.example.test', appBaseUrl: 'https://app.example.test' };
  assert.deepEqual(await fanoutNotificationEmails(deps), { queued: 1 });
  assert.deepEqual(await fanoutNotificationEmails(deps), { queued: 0 }, 'second sweep creates nothing');
  assert.equal(db.outbox.length, 1); assert.equal(db.outbox[0].toEmail, 'a@x.test'); assert.equal(db.outbox[0].dedupeKey, 'notification:a');
  assert.match(db.outbox[0].bodyText, /api\.example\.test\/api\/email\/unsubscribe\?token=/);
});
test('send: success, idempotency key, and no duplicate after a second run', async () => {
  const db = fake({ notifications: [notif('a')] }); const p = ok();
  await fanoutNotificationEmails({ db, provider: p, now: () => now });
  assert.deepEqual(await sendQueuedEmails({ db, provider: p, now: () => now }), { sent: 1, retried: 0, failed: 0, expired: 0, suppressed: 0 });
  assert.equal(p.sent[0].idempotencyKey, 'notification:a'); assert.equal(db.outbox[0].status, 'sent'); assert.equal(db.outbox[0].providerMessageId, 'm1');
  await sendQueuedEmails({ db, provider: p, now: () => now }); assert.equal(p.sent.length, 1);
});
test('transient failures back off then fail at the limit; permanent failures fail immediately', async () => {
  const db = fake({ outbox: [{ id: 'o1', status: 'queued', attempts: 0, maxAttempts: 2, toEmail: 'a@x.test', subject: 's', bodyText: 'b', dedupeKey: 'k1', userId: null, category: 'exam', nextAttemptAt: at(-1) }, { id: 'o2', status: 'queued', attempts: 0, maxAttempts: 5, toEmail: 'b@x.test', subject: 's', bodyText: 'b', dedupeKey: 'k2', userId: null, category: 'exam', nextAttemptAt: at(-1) }] });
  const p: EmailProvider = { name: 'f', async send(m) { throw m.to.startsWith('a') ? new EmailTransientError('boom api_key=abcdefgh1234') : new EmailPermanentError('rejected (422)'); } };
  assert.deepEqual(await sendQueuedEmails({ db, provider: p, now: () => now }), { sent: 0, retried: 1, failed: 1, expired: 0, suppressed: 0 });
  const [o1, o2] = db.outbox; assert.equal(o1.status, 'queued'); assert.ok(o1.nextAttemptAt > now); assert.ok(!o1.lastError.includes('abcdefgh1234')); assert.equal(o2.status, 'failed');
  o1.nextAttemptAt = at(-1); assert.equal((await sendQueuedEmails({ db, provider: p, now: () => now })).failed, 1); assert.equal(o1.status, 'failed');
});
test('expired reminders and opted-out users are never sent; stuck sending rows recover', async () => {
  const base = { status: 'queued', attempts: 0, maxAttempts: 5, toEmail: 'a@x.test', subject: 's', bodyText: 'b', category: 'exam', nextAttemptAt: at(-1) };
  const db = fake({ prefs: [{ userId: 'u2', examEmails: false, adminEmails: true }], outbox: [{ id: 'o1', dedupeKey: 'k1', userId: 'u1', expiresAt: at(-1000), ...base }, { id: 'o2', dedupeKey: 'k2', userId: 'u2', expiresAt: at(60_000), ...base }, { id: 'o3', dedupeKey: 'k3', userId: 'u3', expiresAt: at(60_000), ...base, status: 'sending', updatedAt: at(-20 * 60_000) }] });
  const p = ok(); const r = await sendQueuedEmails({ db, provider: p, now: () => now });
  assert.deepEqual([r.expired, r.suppressed, r.sent], [1, 1, 1]); assert.deepEqual(p.sent.map(m => m.idempotencyKey), ['k3']);
});
test('two workers cannot both send the same row', async () => {
  const db = fake({ outbox: [{ id: 'o1', status: 'queued', attempts: 0, maxAttempts: 5, toEmail: 'a@x.test', subject: 's', bodyText: 'b', dedupeKey: 'k', userId: null, category: 'exam', nextAttemptAt: at(-1) }] });
  const p = ok(); await Promise.all([sendQueuedEmails({ db, provider: p, now: () => now }), sendQueuedEmails({ db, provider: p, now: () => now })]);
  assert.equal(p.sent.length, 1);
});
test('unsubscribe tokens verify only for the right user, category and secret', () => {
  const t = signUnsubscribe('u1', 'exam', 'secret');
  assert.deepEqual(verifyUnsubscribe(t, 'secret'), { userId: 'u1', category: 'exam' });
  assert.equal(verifyUnsubscribe(t, 'other'), null); assert.equal(verifyUnsubscribe(t.replace('u1', 'u2'), 'secret'), null);
  assert.equal(verifyUnsubscribe(t.replace('.exam.', '.admin.'), 'secret'), null); assert.equal(verifyUnsubscribe('x.y', 'secret'), null); assert.equal(verifyUnsubscribe(`${t}.extra`, 'secret'), null);
});
test('email body carries the notice, a non-accusatory footer and no unsubscribe link when unavailable', () => {
  const body = composeEmail({ title: 't', body: 'Hello' }, {}); assert.match(body, /not a finding about anyone/); assert.match(body, /notification bell/); assert.ok(!body.includes('unsubscribe'));
});
test('provider: classifies errors, sends the idempotency key, never leaks credentials', async () => {
  const calls: any[] = []; let status = 200;
  const f = (async (url: string, init: any) => { calls.push({ url, init }); return { ok: status < 300, status, json: async () => ({ id: 'abc' }) } as Response; }) as unknown as typeof fetch;
  const p = new WebhookEmailProvider('https://mail.example.test/send', 'no-reply@x.test', 'KEY123', 1000, f);
  assert.deepEqual(await p.send({ to: 'a@x.test', subject: 's', text: 't', idempotencyKey: 'k' }), { messageId: 'abc' });
  assert.equal(calls[0].init.headers['Idempotency-Key'], 'k'); assert.equal(calls[0].init.headers.Authorization, 'Bearer KEY123');
  status = 503; await assert.rejects(p.send({ to: 'a', subject: 's', text: 't', idempotencyKey: 'k' }), EmailTransientError);
  status = 429; await assert.rejects(p.send({ to: 'a', subject: 's', text: 't', idempotencyKey: 'k' }), EmailTransientError);
  status = 400; await assert.rejects(p.send({ to: 'a', subject: 's', text: 't', idempotencyKey: 'k' }), (e: Error) => e instanceof EmailPermanentError && !e.message.includes('KEY123') && !e.message.includes('mail.example'));
  const down = new WebhookEmailProvider('https://mail.example.test/send', 'f', undefined, 1000, (async () => { throw new Error('ECONNREFUSED mail.example.test'); }) as typeof fetch);
  await assert.rejects(down.send({ to: 'a', subject: 's', text: 't', idempotencyKey: 'k' }), (e: Error) => e instanceof EmailTransientError && !e.message.includes('mail.example'));
});
test('provider configuration is fail-closed and requires https (or localhost)', () => {
  assert.equal(emailProviderFromEnv({}), null);
  assert.equal(emailProviderFromEnv({ EMAIL_PROVIDER: 'webhook', EMAIL_URL: 'http://mail.example.test/send', EMAIL_FROM: 'a@x.test' }), null);
  assert.equal(emailProviderFromEnv({ EMAIL_PROVIDER: 'webhook', EMAIL_URL: 'not a url', EMAIL_FROM: 'a@x.test' }), null);
  assert.equal(emailProviderFromEnv({ EMAIL_PROVIDER: 'smtp', EMAIL_URL: 'https://x.test', EMAIL_FROM: 'a@x.test' }), null);
  assert.ok(emailProviderFromEnv({ EMAIL_PROVIDER: 'webhook', EMAIL_URL: 'https://mail.example.test/send', EMAIL_FROM: 'a@x.test' }));
  assert.ok(emailProviderFromEnv({ EMAIL_PROVIDER: 'webhook', EMAIL_URL: 'http://localhost:8025/send', EMAIL_FROM: 'a@x.test' }));
});
