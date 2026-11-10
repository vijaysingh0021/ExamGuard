import type { Job, JobStore, NewJob } from './jobs.js';
import { safeJobError } from './jobs.js';
import type { WorkflowDb } from './workflows.js';

/** PostgreSQL-backed JobStore. `FOR UPDATE SKIP LOCKED` lets several API instances poll safely without Redis. */
export function createPrismaJobStore(db: WorkflowDb): JobStore {
  const toJob = (r: any): Job => ({ id: r.id, type: r.type, key: r.key, organizationId: r.organizationId ?? undefined, payload: (r.payload ?? {}) as Record<string, unknown>, status: r.status, attempts: r.attempts, maxAttempts: r.maxAttempts, runAt: r.runAt, leaseOwner: r.leaseOwner ?? undefined, leaseExpiresAt: r.leaseExpiresAt ?? undefined, lastError: r.lastError ?? undefined });
  return {
    async enqueue(job: NewJob) {
      try {
        await db.backgroundJob.create({ data: { type: job.type, key: job.key, organizationId: job.organizationId, payload: job.payload ?? {}, runAt: job.runAt ?? new Date(), maxAttempts: job.maxAttempts ?? 5 } });
        return { created: true };
      } catch (error) { if ((error as { code?: string }).code === 'P2002') return { created: false }; throw error; }
    },
    async claim(workerId, now, limit, leaseMs) {
      return db.$transaction(async tx => {
        const due: Array<{ id: string }> = await tx.$queryRaw`SELECT "id" FROM "background_jobs" WHERE (("status" = 'queued' AND "runAt" <= ${now}) OR ("status" = 'running' AND "leaseExpiresAt" <= ${now})) ORDER BY "runAt" ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
        if (!due.length) return [];
        const ids = due.map(r => r.id);
        await tx.backgroundJob.updateMany({ where: { id: { in: ids } }, data: { status: 'running', attempts: { increment: 1 }, leaseOwner: workerId, leaseExpiresAt: new Date(now.getTime() + leaseMs) } });
        return (await tx.backgroundJob.findMany({ where: { id: { in: ids } } })).map(toJob);
      });
    },
    async succeed(id, workerId) { return (await db.backgroundJob.updateMany({ where: { id, leaseOwner: workerId, status: 'running' }, data: { status: 'succeeded', leaseOwner: null, leaseExpiresAt: null, lastError: null } })).count === 1; },
    async fail(id, workerId, patch) { return (await db.backgroundJob.updateMany({ where: { id, leaseOwner: workerId, status: 'running' }, data: { status: patch.status, runAt: patch.runAt, lastError: safeJobError(patch.lastError), leaseOwner: null, leaseExpiresAt: null } })).count === 1; },
    /** Only organization-scoped outcomes that need attention are audited here; sweeps audit their own domain events. */
    async audit(e) { if (e.organizationId && e.outcome !== 'succeeded') await db.auditLog.create({ data: { organizationId: e.organizationId, actorId: null, action: `job.${e.outcome}`, targetType: 'BackgroundJob', targetId: e.jobId, metadata: { type: e.type, attempts: e.attempts } } }); },
  };
}
