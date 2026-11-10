import crypto from 'node:crypto';

/**
 * Durable job core. Pure logic + a store interface so retry, lease, idempotency and
 * dead-letter behaviour is testable without a database. Persistence is PostgreSQL
 * (table `background_jobs`, see prisma/migrations/20261107000000_background_jobs).
 * Critical exam deadlines must never depend on in-process timers; they are rows that
 * any worker can claim after a restart.
 */
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'dead';
export interface Job { id: string; type: string; key: string; organizationId?: string; payload: Record<string, unknown>; status: JobStatus; attempts: number; maxAttempts: number; runAt: Date; leaseOwner?: string; leaseExpiresAt?: Date; lastError?: string }
export interface NewJob { type: string; key: string; organizationId?: string; payload?: Record<string, unknown>; runAt?: Date; maxAttempts?: number }
export type JobHandler = (job: Job) => Promise<void>;
/** Throw this from a handler for failures that retrying cannot fix. */
export class PermanentJobError extends Error {}

export const jobKey = (type: string, ...parts: Array<string | number>) =>
  `${type}:${crypto.createHash('sha256').update(parts.map(String).join('\u0000')).digest('hex').slice(0, 32)}`;

export const backoffMs = (attempt: number, baseMs = 5_000, capMs = 15 * 60_000, random = Math.random) =>
  Math.round(Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1)) * (0.5 + random() / 2));

/** Errors are persisted for operators; keep them short and free of secrets/PII. */
export const safeJobError = (error: unknown) =>
  String(error instanceof Error ? error.message : error)
    .replace(/(?:bearer\s+|password=|secret=|token=|key=)\S+/gi, '[redacted]')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[redacted-email]')
    .slice(0, 300);

export const leaseExpired = (job: Pick<Job, 'status' | 'leaseExpiresAt'>, now: Date) =>
  job.status === 'running' && !!job.leaseExpiresAt && job.leaseExpiresAt <= now;

export const afterFailure = (job: Pick<Job, 'attempts' | 'maxAttempts'>, error: unknown, now: Date, random = Math.random) => {
  const attempts = job.attempts; // already incremented at claim time
  const permanent = error instanceof PermanentJobError;
  if (permanent || attempts >= job.maxAttempts) return { status: 'dead' as const, runAt: now, lastError: safeJobError(error) };
  return { status: 'queued' as const, runAt: new Date(now.getTime() + backoffMs(attempts, undefined, undefined, random)), lastError: safeJobError(error) };
};

export interface JobStore {
  /** Insert unless a job with the same key exists. Returns whether a new row was created. */
  enqueue(job: NewJob): Promise<{ created: boolean }>;
  /** Atomically claim up to `limit` due jobs (queued, or running with an expired lease), incrementing attempts. */
  claim(workerId: string, now: Date, limit: number, leaseMs: number): Promise<Job[]>;
  succeed(id: string, workerId: string, now: Date): Promise<boolean>;
  fail(id: string, workerId: string, patch: { status: 'queued' | 'dead'; runAt: Date; lastError: string }): Promise<boolean>;
  audit?(event: { jobId: string; type: string; outcome: 'succeeded' | 'retry' | 'dead'; attempts: number; organizationId?: string }): Promise<void>;
}

/** One polling tick. Handlers must be idempotent: a lease can expire while work is still running. */
export async function runDueJobs(store: JobStore, handlers: Record<string, JobHandler>, opts: { workerId: string; now?: () => Date; limit?: number; leaseMs?: number; random?: () => number }) {
  const now = opts.now ?? (() => new Date());
  const claimed = await store.claim(opts.workerId, now(), opts.limit ?? 5, opts.leaseMs ?? 60_000);
  const summary = { succeeded: 0, retried: 0, dead: 0 };
  for (const job of claimed) {
    try {
      const handler = handlers[job.type];
      if (!handler) throw new PermanentJobError(`No handler registered for ${job.type}`);
      await handler(job);
      if (await store.succeed(job.id, opts.workerId, now())) { summary.succeeded++; await store.audit?.({ jobId: job.id, type: job.type, outcome: 'succeeded', attempts: job.attempts, organizationId: job.organizationId }); }
    } catch (error) {
      const patch = afterFailure(job, error, now(), opts.random);
      if (await store.fail(job.id, opts.workerId, patch)) {
        patch.status === 'dead' ? summary.dead++ : summary.retried++;
        await store.audit?.({ jobId: job.id, type: job.type, outcome: patch.status === 'dead' ? 'dead' : 'retry', attempts: job.attempts, organizationId: job.organizationId });
      }
    }
  }
  return summary;
}

// The PostgreSQL implementation lives in job-store.ts (SELECT ... FOR UPDATE SKIP LOCKED inside a transaction).

/** In-memory store with the same semantics, used by tests and local tooling only. */
export class MemoryJobStore implements JobStore {
  jobs = new Map<string, Job>(); audits: Array<Record<string, unknown>> = []; private seq = 0;
  async enqueue(n: NewJob) {
    if ([...this.jobs.values()].some(j => j.key === n.key)) return { created: false };
    const id = `job-${++this.seq}`;
    this.jobs.set(id, { id, type: n.type, key: n.key, organizationId: n.organizationId, payload: n.payload ?? {}, status: 'queued', attempts: 0, maxAttempts: n.maxAttempts ?? 5, runAt: n.runAt ?? new Date(0) });
    return { created: true };
  }
  async claim(workerId: string, now: Date, limit: number, leaseMs: number) {
    const due = [...this.jobs.values()].filter(j => (j.status === 'queued' && j.runAt <= now) || leaseExpired(j, now)).sort((a, b) => +a.runAt - +b.runAt).slice(0, limit);
    for (const j of due) Object.assign(j, { status: 'running', attempts: j.attempts + 1, leaseOwner: workerId, leaseExpiresAt: new Date(now.getTime() + leaseMs) });
    return due.map(j => ({ ...j }));
  }
  async succeed(id: string, workerId: string) { const j = this.jobs.get(id); if (!j || j.leaseOwner !== workerId || j.status !== 'running') return false; j.status = 'succeeded'; j.leaseOwner = undefined; return true; }
  async fail(id: string, workerId: string, p: { status: 'queued' | 'dead'; runAt: Date; lastError: string }) { const j = this.jobs.get(id); if (!j || j.leaseOwner !== workerId || j.status !== 'running') return false; Object.assign(j, p, { leaseOwner: undefined }); return true; }
  async audit(e: Record<string, unknown>) { this.audits.push(e); }
}
