import { runDueJobs, type JobHandler, type JobStore } from './jobs.js';
import { bucketKey } from './lifecycle.js';

export interface SweepSchedule { type: string; everyMs: number }
export interface JobRunnerOptions {
  store: JobStore; handlers: Record<string, JobHandler>; sweeps: SweepSchedule[]; workerId: string;
  tickMs?: number; leaseMs?: number; now?: () => Date; log?: (level: 'info' | 'error', message: string, extra?: Record<string, unknown>) => void;
}

/**
 * Polling worker. The interval timer only decides WHEN to look for work; everything that matters (what is due, retries,
 * leases, idempotency) is stored in PostgreSQL, so a restart or a second API instance loses and duplicates nothing.
 */
export function createJobRunner(o: JobRunnerOptions) {
  const now = o.now ?? (() => new Date()); const log = o.log ?? (() => undefined);
  let timer: ReturnType<typeof setInterval> | undefined; let inFlight: Promise<void> | undefined; let stopped = false;

  async function tick() {
    if (inFlight || stopped) return;
    inFlight = (async () => {
      try {
        const at = now();
        for (const s of o.sweeps) await o.store.enqueue({ type: s.type, key: bucketKey(s.type, at, s.everyMs), maxAttempts: 3, runAt: at });
        const summary = await runDueJobs(o.store, o.handlers, { workerId: o.workerId, now, limit: 5, leaseMs: o.leaseMs ?? 120_000 });
        if (summary.retried || summary.dead) log('error', 'background jobs had failures', summary);
        else if (summary.succeeded) log('info', 'background jobs completed', summary);
      } catch (error) { log('error', 'job runner tick failed', { error: error instanceof Error ? error.message : String(error) }); }
      finally { inFlight = undefined; }
    })();
    await inFlight;
  }
  return {
    tick,
    start() { if (timer || stopped) return; timer = setInterval(() => { void tick(); }, o.tickMs ?? 15_000); timer.unref?.(); void tick(); },
    /** Stop scheduling and wait (bounded) for the in-flight tick so shutdown never abandons a half-finished job step. */
    async stop(timeoutMs = 10_000) {
      stopped = true; if (timer) clearInterval(timer); timer = undefined;
      if (inFlight) await Promise.race([inFlight, new Promise(r => setTimeout(r, timeoutMs).unref?.())]);
    },
    get running() { return !!timer; },
  };
}
