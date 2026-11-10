import assert from 'node:assert/strict';
import test from 'node:test';
import { createJobRunner } from '../src/job-runner.js';
import { MemoryJobStore } from '../src/jobs.js';
import { SWEEPS, advanceExamLifecycle, closeExpiredAttempts, remindStaleIncidents, runRetention, sendExamReminders, workflowHandlers, type WorkflowDb } from '../src/workflows.js';

const now = new Date('2026-11-07T10:00:00Z');
const at = (ms: number) => new Date(now.getTime() + ms);
const ORG_A = 'org-a', ORG_B = 'org-b';
type Row = Record<string, any>;

/** Minimal in-memory stand-in for the Prisma calls the workflows use. It does NOT evaluate Prisma `where` semantics. */
function fakeDb(s: { attempts?: Row[]; exams?: Row[]; assignments?: Row[]; notifications?: Row[]; incidents?: Row[]; memberships?: Row[]; evidence?: Row[]; failUpdateFor?: string; beforeLock?: (id: string) => void }) {
  const audits: Row[] = []; const notifications = s.notifications ?? []; const attempts = s.attempts ?? [];
  const db: any = {
    audits, notifications, attempts,
    $transaction: async (fn: any) => fn(db),
    $queryRaw: async (_s: any, id: string) => { s.beforeLock?.(id); return attempts.some(a => a.id === id && a.status === 'in_progress') ? [{ id }] : []; },
    examAttempt: {
      findMany: async (args: any) => args?.where?.examId ? attempts.filter(a => a.examId === args.where.examId && a.organizationId === args.where.organizationId).map(a => ({ userId: a.userId })) : attempts.filter(a => a.status === 'in_progress' && a.deadlineAt <= now).map(a => ({ id: a.id })),
      findUnique: async ({ where }: any) => attempts.find(a => a.id === where.id) ?? null,
      update: async ({ where, data }: any) => { if (s.failUpdateFor === where.id) throw new Error('db down'); Object.assign(attempts.find(a => a.id === where.id)!, data); },
    },
    exam: {
      findMany: async () => s.exams ?? [],
      updateMany: async ({ where, data }: any) => { const e = (s.exams ?? []).find(x => x.id === where.id && x.status === where.status); if (e) Object.assign(e, data); return { count: e ? 1 : 0 }; },
    },
    examAssignment: { findMany: async ({ where }: any) => (s.assignments ?? []).filter(a => a.examId === where.examId && a.organizationId === where.organizationId && a.candidate.organizationId === where.organizationId && a.candidate.userId) .map(a => ({ candidate: { userId: a.candidate.userId } })) },
    notification: {
      create: async ({ data }: any) => { notifications.push(data); },
      createMany: async ({ data }: any) => { notifications.push(...data); },
      findMany: async ({ where }: any) => notifications.filter(n => n.organizationId === where.organizationId && n.type === where.type && (!where.userId || where.userId.in.includes(n.userId)) && (!where.metadata || n.metadata?.dedupeKey === where.metadata.equals)).map(n => ({ userId: n.userId, id: 'n' })),
    },
    auditLog: { create: async ({ data }: any) => { audits.push(data); } },
    membership: { findMany: async ({ where }: any) => (s.memberships ?? []).filter(m => m.organizationId === where.organizationId && m.active && m.role === where.role) },
    incident: { groupBy: async () => s.incidents ?? [] },
    proctoringEvent: { groupBy: async () => s.evidence ?? [] },
    backgroundJob: { deleteMany: async () => ({ count: 3 }) },
  };
  return db as WorkflowDb & { audits: Row[]; notifications: Row[]; attempts: Row[] };
}
const attempt = (id: string, over: Row = {}) => ({ id, organizationId: ORG_A, userId: `u-${id}`, status: 'in_progress', deadlineAt: at(-1000), ...over });

test('deadline sweep closes only expired in-progress attempts, with receipt, audit and notification', async () => {
  const db = fakeDb({ attempts: [attempt('a1'), attempt('a2', { deadlineAt: at(60_000) }), attempt('a3', { status: 'submitted' })] });
  const r = await closeExpiredAttempts({ db, now: () => now });
  assert.deepEqual(r, { closed: 1, skipped: 0, failed: 0 });
  const a1 = db.attempts[0]; assert.equal(a1.status, 'expired'); assert.equal(a1.submittedAt, a1.deadlineAt); assert.match(a1.receiptCode, /^EG-/);
  assert.equal(db.attempts[1].status, 'in_progress'); assert.equal(db.attempts[2].status, 'submitted');
  assert.equal(db.audits[0].action, 'attempt.auto_submitted'); assert.equal(db.audits[0].actorId, null);
  assert.equal(db.notifications.length, 1); assert.equal(db.notifications[0].userId, 'u-a1');
});
test('deadline sweep is idempotent and respects a candidate submit that wins the lock', async () => {
  const db = fakeDb({ attempts: [attempt('a1'), attempt('a2')], beforeLock: id => { if (id === 'a2') db.attempts[1].status = 'submitted'; } });
  const first = await closeExpiredAttempts({ db, now: () => now });
  assert.deepEqual(first, { closed: 1, skipped: 1, failed: 0 });
  assert.equal(db.attempts[1].status, 'submitted', 'candidate submission is never overwritten');
  assert.deepEqual(await closeExpiredAttempts({ db, now: () => now }), { closed: 0, skipped: 0, failed: 0 });
  assert.equal(db.audits.length, 1); assert.equal(db.notifications.length, 1);
});
test('deadline sweep keeps going after an item fails, then fails the job so it retries', async () => {
  const db = fakeDb({ attempts: [attempt('a1'), attempt('a2')], failUpdateFor: 'a1' });
  await assert.rejects(closeExpiredAttempts({ db, now: () => now }), /1 item\(s\) failed/);
  assert.equal(db.attempts[1].status, 'expired');
});
test('lifecycle: scheduled exam goes live; ended exam completes only without open attempts', async () => {
  const exams = [
    { id: 'e1', organizationId: ORG_A, status: 'scheduled', startsAt: at(-1), endsAt: at(HOUR_), attempts: [] },
    { id: 'e2', organizationId: ORG_A, status: 'live', startsAt: at(-HOUR_), endsAt: at(-1), attempts: [] },
    { id: 'e3', organizationId: ORG_A, status: 'live', startsAt: at(-HOUR_), endsAt: at(-1), attempts: [{ id: 'x' }] },
  ];
  const db = fakeDb({ exams });
  assert.deepEqual(await advanceExamLifecycle({ db, now: () => now }), { live: 1, completed: 1, failed: 0 });
  assert.deepEqual(exams.map(e => e.status), ['live', 'completed', 'live']);
  assert.deepEqual(db.audits.map(a => a.action), ['exam.went_live', 'exam.completed']);
  assert.deepEqual(await advanceExamLifecycle({ db, now: () => now }), { live: 0, completed: 0, failed: 0 });
});
const HOUR_ = 3_600_000;

test('reminders reach only assigned, unstarted candidates of the exam organization, once per window', async () => {
  const exam = { id: 'e1', organizationId: ORG_A, title: 'Maths', startsAt: at(30 * 60_000) };
  const db = fakeDb({
    exams: [exam],
    assignments: [
      { examId: 'e1', organizationId: ORG_A, candidate: { organizationId: ORG_A, userId: 'u1' } },
      { examId: 'e1', organizationId: ORG_A, candidate: { organizationId: ORG_A, userId: 'u2' } },
      { examId: 'e1', organizationId: ORG_A, candidate: { organizationId: ORG_A, userId: null } },
      { examId: 'other', organizationId: ORG_A, candidate: { organizationId: ORG_A, userId: 'u9' } },
      { examId: 'e1', organizationId: ORG_B, candidate: { organizationId: ORG_B, userId: 'u8' } },
    ],
    attempts: [{ examId: 'e1', organizationId: ORG_A, userId: 'u2', status: 'in_progress' }],
  });
  assert.deepEqual(await sendExamReminders({ db, now: () => now }), { notified: 1, failed: 0 });
  assert.deepEqual(db.notifications.map(n => n.userId), ['u1']);
  assert.equal(db.notifications[0].metadata.window, '1h'); assert.equal(db.notifications[0].organizationId, ORG_A);
  assert.deepEqual(await sendExamReminders({ db, now: () => now }), { notified: 0, failed: 0 });
  assert.equal(db.notifications.length, 1);
});
test('incident review reminders: once per day, administrators only, counts only', async () => {
  const db = fakeDb({ incidents: [{ organizationId: ORG_A, _count: { _all: 4 } }], memberships: [{ organizationId: ORG_A, active: true, role: 'institute_admin', userId: 'admin1' }, { organizationId: ORG_A, active: true, role: 'teacher', userId: 't1' }] });
  assert.deepEqual(await remindStaleIncidents({ db, now: () => now }), { organizations: 1, failed: 0 });
  assert.deepEqual(db.notifications.map(n => n.userId), ['admin1']); assert.ok(!JSON.stringify(db.notifications[0]).includes('candidate'));
  assert.deepEqual(await remindStaleIncidents({ db, now: () => now }), { organizations: 0, failed: 0 });
});
test('retention reports evidence past retention but never deletes it, and only when configured', async () => {
  const mk = () => fakeDb({ evidence: [{ organizationId: ORG_A, _count: { _all: 7 } }], memberships: [{ organizationId: ORG_A, active: true, role: 'institute_admin', userId: 'admin1' }] });
  const off = mk(); assert.equal((await runRetention({ db: off, now: () => now, purgeExpired: async () => ({ x: 2 }) })).evidenceOrgsFlagged, 0);
  const db = mk(); const r = await runRetention({ db, now: () => now, evidenceRetentionDays: 90, purgeExpired: async () => ({ x: 2, y: 1 }) });
  assert.deepEqual(r, { purged: 3, jobsRemoved: 3, evidenceOrgsFlagged: 1, failed: 0 });
  assert.equal(db.audits[0].action, 'evidence.retention_due'); assert.equal(db.audits[0].metadata.autoDeleted, false);
  assert.equal(db.notifications[0].type, 'retention_due'); assert.equal((db as any).proctoringEvent.deleteMany, undefined);
  assert.equal((await runRetention({ db, now: () => now, evidenceRetentionDays: 90 })).evidenceOrgsFlagged, 0, 'monthly de-duplication');
});
test('runner: enqueues one keyed job per sweep per bucket, runs handlers, survives restart without duplicates', async () => {
  const store = new MemoryJobStore(); const ran: string[] = [];
  const handlers = Object.fromEntries(Object.keys(SWEEPS).map(t => [t, async () => { ran.push(t); }]));
  const sweeps = Object.entries(SWEEPS).map(([type, s]) => ({ type, everyMs: s.everyMs }));
  const mk = (id: string) => createJobRunner({ store, handlers, sweeps, workerId: id, now: () => now });
  await mk('w1').tick(); await mk('w2').tick();
  assert.equal(store.jobs.size, Object.keys(SWEEPS).length, 'two instances share one job per sweep');
  assert.equal(ran.length, Object.keys(SWEEPS).length, 'each sweep ran exactly once');
});
test('runner: a failing sweep retries with backoff and then succeeds; stop() waits for the in-flight tick', async () => {
  const store = new MemoryJobStore(); let calls = 0; let t = now;
  const handlers = { 'sweep.x': async () => { calls++; if (calls === 1) throw new Error('transient'); } };
  const runner = createJobRunner({ store, handlers, sweeps: [{ type: 'sweep.x', everyMs: 60_000 }], workerId: 'w', now: () => t });
  await runner.tick(); assert.equal([...store.jobs.values()][0].status, 'queued');
  t = new Date(t.getTime() + 20 * 60_000); await runner.tick();
  const original = [...store.jobs.values()].find(j => j.attempts === 2)!; // the failed job was retried, not duplicated
  assert.equal(original.status, 'succeeded'); assert.equal(calls, 3, 'retry + the new time bucket job');
  let release!: () => void; const gate = new Promise<void>(r => { release = r; });
  const slow = createJobRunner({ store: new MemoryJobStore(), handlers: { 'sweep.s': async () => { await gate; } }, sweeps: [{ type: 'sweep.s', everyMs: 1 }], workerId: 'w', now: () => now });
  const p = slow.tick(); let stopped = false; const stopP = slow.stop(5000).then(() => { stopped = true; });
  await new Promise(r => setTimeout(r, 20)); assert.equal(stopped, false); release(); await p; await stopP; assert.equal(stopped, true);
});
test('every scheduled sweep has a registered handler', () => {
  const handlers = workflowHandlers({ db: fakeDb({}) });
  for (const type of Object.keys(SWEEPS)) assert.equal(typeof handlers[type], 'function', type);
});
