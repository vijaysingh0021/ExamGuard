import os from 'node:os';
import { emailProviderFromEnv } from './email.js';
import { createJobRunner } from './job-runner.js';
import { createPrismaJobStore } from './job-store.js';
import { parseRetentionDays } from './lifecycle.js';
import { purgeExpired } from './maintenance.js';
import { prisma } from './prisma.js';
import { SWEEPS, workflowHandlers, type WorkflowDb } from './workflows.js';

/** Starts durable background processing. Disable with BACKGROUND_JOBS_ENABLED=false (for example on a read-only replica). */
export function startBackgroundJobs(env: Record<string, string | undefined> = process.env) {
  if (env.BACKGROUND_JOBS_ENABLED === 'false') { console.info('Background jobs disabled by configuration'); return { stop: async () => undefined }; }
  const db = prisma as unknown as WorkflowDb; // structural subset of PrismaClient; see WorkflowDb
  const runner = createJobRunner({
    store: createPrismaJobStore(db),
    handlers: workflowHandlers({ db, email: { provider: emailProviderFromEnv(env), unsubscribeSecret: env.JWT_SECRET, apiBaseUrl: env.PUBLIC_API_URL, appBaseUrl: env.APP_BASE_URL }, evidenceRetentionDays: parseRetentionDays(env.EVIDENCE_RETENTION_DAYS), purgeExpired }),
    sweeps: Object.entries(SWEEPS).map(([type, s]) => ({ type, everyMs: s.everyMs })),
    workerId: `${os.hostname()}-${process.pid}`,
    log: (level, message, extra) => (level === 'error' ? console.error : console.info)(`[jobs] ${message}`, extra ?? ''),
  });
  runner.start();
  console.info('Background jobs started');
  return { stop: () => runner.stop() };
}
