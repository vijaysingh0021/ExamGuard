import { DAY, HOUR, isoDay, receiptCodeFor, reminderWindow, retentionCutoff, timeDrivenExamStatus } from './lifecycle.js';
import { PermanentJobError, type Job, type JobHandler } from './jobs.js';
import { fanoutNotificationEmails, sendQueuedEmails, type EmailDeps, type OutboxDb } from './email-outbox.js';

/**
 * Background workflows. Every handler is idempotent (state-guarded under a row lock or de-duplicated by a key),
 * because a job can run twice after a crash. Domain events are written to the audit log with a null actor
 * (system); nothing here accuses, penalizes or decides misconduct.
 */
type Delegate = Record<string, (args?: any) => Promise<any>>;
export interface WorkflowDb {
  examAttempt: Delegate; exam: Delegate; examAssignment: Delegate; notification: Delegate; auditLog: Delegate;
  membership: Delegate; incident: Delegate; proctoringEvent: Delegate; backgroundJob: Delegate; emailOutbox?: Delegate; emailPreference?: Delegate;
  $transaction<T>(fn: (tx: WorkflowDb) => Promise<T>): Promise<T>;
  $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<any[]>;
}
export interface WorkflowDeps { db: WorkflowDb; now?: () => Date; /** Email wiring; without a provider the email sweeps do nothing. */ email?: Omit<EmailDeps, 'db' | 'now'>; evidenceRetentionDays?: number; purgeExpired?: (now: Date) => Promise<Record<string, number>> }
const BATCH = 200;
const system = (organizationId: string, action: string, targetType: string, targetId: string, metadata?: unknown) => ({ data: { organizationId, actorId: null, action, targetType, targetId, metadata } });

/** Finish the sweep, then fail the job if any item failed so it retries with backoff (items already done are skipped next time). */
const finish = (name: string, summary: Record<string, number>) => { if (summary.failed) throw new Error(`${name}: ${summary.failed} item(s) failed`); return summary; };

/** Close attempts whose server-held deadline has passed: terminal state, receipt, audit and notification commit together. */
export async function closeExpiredAttempts({ db, now = () => new Date() }: WorkflowDeps) {
  const at = now(); const summary = { closed: 0, skipped: 0, failed: 0 };
  const due: Array<{ id: string }> = await db.examAttempt.findMany({ where: { status: 'in_progress', deadlineAt: { lte: at } }, select: { id: true }, orderBy: { deadlineAt: 'asc' }, take: BATCH });
  for (const { id } of due) {
    try {
      const result = await db.$transaction(async tx => {
        const locked = await tx.$queryRaw`SELECT "id" FROM "exam_attempts" WHERE "id" = ${id}::uuid AND "status" = 'in_progress' FOR UPDATE`;
        if (!locked.length) return 'skipped' as const;
        const a = await tx.examAttempt.findUnique({ where: { id } });
        if (!a || a.status !== 'in_progress' || a.deadlineAt > at) return 'skipped' as const;
        await tx.examAttempt.update({ where: { id }, data: { status: 'expired', submittedAt: a.deadlineAt, receiptCode: receiptCodeFor(a.id, a.deadlineAt) } });
        await tx.auditLog.create(system(a.organizationId, 'attempt.auto_submitted', 'ExamAttempt', a.id, { reason: 'deadline_reached', status: 'expired' }));
        await tx.notification.create({ data: { organizationId: a.organizationId, userId: a.userId, type: 'attempt_auto_submitted', title: 'Exam closed at its deadline', body: 'Your saved answers were submitted automatically when time ran out.', delivery: 'email_unconfigured', metadata: { attemptId: a.id } } });
        return 'closed' as const;
      });
      summary[result === 'closed' ? 'closed' : 'skipped']++;
    } catch { summary.failed++; }
  }
  return finish('closeExpiredAttempts', summary);
}

/** scheduled → live at start time; → completed after end time once no attempt is open. */
export async function advanceExamLifecycle({ db, now = () => new Date() }: WorkflowDeps) {
  const at = now(); const summary = { live: 0, completed: 0, failed: 0 };
  const candidates: Array<{ id: string; organizationId: string; status: string; startsAt: Date | null; endsAt: Date | null; attempts: Array<{ id: string }> }> = await db.exam.findMany({
    where: { OR: [{ status: 'scheduled', startsAt: { lte: at } }, { status: { in: ['published', 'scheduled', 'live'] }, endsAt: { lte: at } }] },
    select: { id: true, organizationId: true, status: true, startsAt: true, endsAt: true, attempts: { where: { status: { in: ['in_progress', 'paused'] } }, select: { id: true }, take: 1 } }, take: BATCH,
  });
  for (const exam of candidates) {
    try {
      const next = timeDrivenExamStatus(exam, at, exam.attempts.length > 0);
      if (!next) continue;
      const changed = await db.exam.updateMany({ where: { id: exam.id, status: exam.status }, data: { status: next } });
      if (changed.count) { await db.auditLog.create(system(exam.organizationId, next === 'live' ? 'exam.went_live' : 'exam.completed', 'Exam', exam.id, { from: exam.status })); summary[next]++; }
    } catch { summary.failed++; }
  }
  return finish('advanceExamLifecycle', summary);
}

/** Reminders go only to candidates assigned to this exam in this organization, once per window (de-duplicated by key). */
export async function sendExamReminders({ db, now = () => new Date() }: WorkflowDeps) {
  const at = now(); const summary = { notified: 0, failed: 0 };
  const exams: Array<{ id: string; organizationId: string; title: string; startsAt: Date }> = await db.exam.findMany({
    where: { status: { in: ['published', 'scheduled'] }, startsAt: { gt: at, lte: new Date(at.getTime() + DAY) } }, select: { id: true, organizationId: true, title: true, startsAt: true }, take: BATCH });
  for (const exam of exams) {
    try {
      const window = reminderWindow(exam.startsAt, at); if (!window) continue;
      const [assignments, attempts]: [Array<{ candidate: { userId: string } }>, Array<{ userId: string }>] = await Promise.all([
        db.examAssignment.findMany({ where: { examId: exam.id, organizationId: exam.organizationId, candidate: { organizationId: exam.organizationId, userId: { not: null } } }, select: { candidate: { select: { userId: true } } } }),
        db.examAttempt.findMany({ where: { examId: exam.id, organizationId: exam.organizationId }, select: { userId: true } }),
      ]);
      const started = new Set(attempts.map(a => a.userId));
      const userIds = [...new Set(assignments.map(a => a.candidate.userId))].filter(id => !started.has(id));
      if (!userIds.length) continue;
      const dedupeKey = `exam_reminder:${exam.id}:${window}`;
      const already: Array<{ userId: string }> = await db.notification.findMany({ where: { organizationId: exam.organizationId, type: 'exam_reminder', userId: { in: userIds }, metadata: { path: ['dedupeKey'], equals: dedupeKey } }, select: { userId: true } });
      const sent = new Set(already.map(n => n.userId));
      const recipients = userIds.filter(id => !sent.has(id));
      if (!recipients.length) continue;
      await db.notification.createMany({ data: recipients.map(userId => ({ organizationId: exam.organizationId, userId, type: 'exam_reminder', title: `Upcoming exam: ${exam.title}`, body: window === '1h' ? 'Your exam starts within the hour. Check your camera, microphone and connection now.' : 'Your exam starts within 24 hours. Open the readiness check to confirm your device is ready.', delivery: 'email_unconfigured', metadata: { dedupeKey, examId: exam.id, startsAt: exam.startsAt, window } })) });
      await db.auditLog.create(system(exam.organizationId, 'exam.reminders_sent', 'Exam', exam.id, { window, recipients: recipients.length }));
      summary.notified += recipients.length;
    } catch { summary.failed++; }
  }
  return finish('sendExamReminders', summary);
}

/** Daily nudge to organization administrators about incidents still waiting for a human decision. Counts only, no candidate detail. */
export async function remindStaleIncidents({ db, now = () => new Date() }: WorkflowDeps) {
  const at = now(); const summary = { organizations: 0, failed: 0 };
  const groups: Array<{ organizationId: string; _count: { _all: number } }> = await db.incident.groupBy({ by: ['organizationId'], where: { status: { in: ['open', 'awaiting_student'] }, createdAt: { lt: new Date(at.getTime() - 48 * HOUR) } }, _count: { _all: true } });
  for (const g of groups) {
    try {
      const dedupeKey = `incident_review:${g.organizationId}:${isoDay(at)}`;
      if ((await db.notification.findMany({ where: { organizationId: g.organizationId, type: 'review_reminder', metadata: { path: ['dedupeKey'], equals: dedupeKey } }, select: { id: true }, take: 1 })).length) continue;
      const admins: Array<{ userId: string }> = await db.membership.findMany({ where: { organizationId: g.organizationId, active: true, role: 'institute_admin' }, select: { userId: true } });
      if (!admins.length) continue;
      await db.notification.createMany({ data: admins.map(m => ({ organizationId: g.organizationId, userId: m.userId, type: 'review_reminder', title: 'Incidents awaiting review', body: `${g._count._all} incident(s) have waited more than 48 hours for a human decision.`, delivery: 'email_unconfigured', metadata: { dedupeKey, count: g._count._all } })) });
      summary.organizations++;
    } catch { summary.failed++; }
  }
  return finish('remindStaleIncidents', summary);
}

/**
 * Housekeeping. Short-lived rows are purged. Evidence is NEVER deleted here: items past the configured retention
 * period are reported to administrators and the audit log so a person decides what happens to them.
 */
export async function runRetention({ db, now = () => new Date(), evidenceRetentionDays, purgeExpired }: WorkflowDeps) {
  const at = now(); const summary: Record<string, number> = { purged: 0, jobsRemoved: 0, evidenceOrgsFlagged: 0, failed: 0 };
  try { if (purgeExpired) summary.purged = Object.values(await purgeExpired(at)).reduce((a, b) => a + b, 0); } catch { summary.failed++; }
  try { await db.emailOutbox?.deleteMany({ where: { status: { in: ['sent', 'failed', 'expired', 'suppressed'] }, updatedAt: { lt: retentionCutoff(at, 30) } } }); } catch { summary.failed++; }
  try { summary.jobsRemoved = (await db.backgroundJob.deleteMany({ where: { status: 'succeeded', updatedAt: { lt: retentionCutoff(at, 7) } } })).count; } catch { summary.failed++; }
  if (evidenceRetentionDays) {
    try {
      const groups: Array<{ organizationId: string; _count: { _all: number } }> = await db.proctoringEvent.groupBy({ by: ['organizationId'], where: { evidenceKey: { not: null }, createdAt: { lt: retentionCutoff(at, evidenceRetentionDays) } }, _count: { _all: true } });
      for (const g of groups) {
        const dedupeKey = `evidence_retention:${g.organizationId}:${isoDay(at).slice(0, 7)}`;
        if ((await db.notification.findMany({ where: { organizationId: g.organizationId, type: 'retention_due', metadata: { path: ['dedupeKey'], equals: dedupeKey } }, select: { id: true }, take: 1 })).length) continue;
        const admins: Array<{ userId: string }> = await db.membership.findMany({ where: { organizationId: g.organizationId, active: true, role: 'institute_admin' }, select: { userId: true } });
        await db.auditLog.create(system(g.organizationId, 'evidence.retention_due', 'Organization', g.organizationId, { retentionDays: evidenceRetentionDays, items: g._count._all, autoDeleted: false }));
        if (admins.length) await db.notification.createMany({ data: admins.map(m => ({ organizationId: g.organizationId, userId: m.userId, type: 'retention_due', title: 'Evidence past its retention period', body: `${g._count._all} evidence item(s) are older than ${evidenceRetentionDays} days. Nothing was deleted; review and decide how to proceed.`, delivery: 'email_unconfigured', metadata: { dedupeKey, count: g._count._all } })) });
        summary.evidenceOrgsFlagged++;
      }
    } catch { summary.failed++; }
  }
  return finish('runRetention', summary);
}

const emailDeps = (d: WorkflowDeps): EmailDeps => ({ db: d.db as unknown as OutboxDb, provider: null, ...d.email, now: d.now });

export const SWEEPS = {
  'sweep.attempt_deadlines': { everyMs: 60_000, run: closeExpiredAttempts },
  'sweep.exam_lifecycle': { everyMs: 60_000, run: advanceExamLifecycle },
  'sweep.exam_reminders': { everyMs: 5 * 60_000, run: sendExamReminders },
  'sweep.review_reminders': { everyMs: 6 * HOUR, run: remindStaleIncidents },
  'sweep.email_fanout': { everyMs: 60_000, run: (d: WorkflowDeps) => fanoutNotificationEmails(emailDeps(d)) },
  'sweep.email_send': { everyMs: 60_000, run: (d: WorkflowDeps) => sendQueuedEmails(emailDeps(d)) },
  'sweep.retention': { everyMs: DAY, run: runRetention },
} as const;
export type SweepType = keyof typeof SWEEPS;

export const workflowHandlers = (deps: WorkflowDeps): Record<string, JobHandler> =>
  Object.fromEntries(Object.entries(SWEEPS).map(([type, s]) => [type, async (job: Job) => { if (job.type !== type) throw new PermanentJobError('Job type mismatch'); await s.run(deps); }]));
