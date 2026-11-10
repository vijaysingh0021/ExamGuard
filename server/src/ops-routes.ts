import type { Express } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, authorize, type AuthRequest } from './auth.js';
import { createAssistant } from './assistant/service.js';
import { classifyIntent } from './assistant/policy.js';
import { providerFromEnv } from './assistant/provider.js';
import { emailProviderFromEnv } from './email.js';
import { evaluateQuota, parseQuotaBytes } from './quota.js';
import { companionConnection } from './companion.js';
import { isUuid } from './ids.js';
import { parseRetentionDays, retentionCutoff } from './lifecycle.js';
import { prisma } from './prisma.js';

const reviewerRoles = ['institute_admin', 'teacher', 'proctor'] as const;
/** Membership role -> assistant role. Derived server-side from the verified membership, never from the request. */
const assistantRoleFor = (role?: string) => ({ student: 'candidate', teacher: 'teacher', proctor: 'reviewer', institute_admin: 'admin' } as Record<string, string>)[role ?? ''];
const chatBody = z.object({ message: z.string().min(1).max(2000), history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(2000) })).max(12).optional() });
const AUDITED_REFUSALS = new Set(['bypass', 'hidden_tests', 'exam_answer']);

async function organizationFacts(organizationId: string, includeJobs: boolean) {
  const [exams, attempts, grades, openIncidents, failedJobs] = await Promise.all([
    prisma.exam.groupBy({ by: ['status'], where: { organizationId }, _count: { _all: true } }),
    prisma.examAttempt.groupBy({ by: ['status'], where: { organizationId }, _count: { _all: true } }),
    prisma.grade.groupBy({ by: ['status'], where: { organizationId }, _count: { _all: true } }),
    prisma.incident.count({ where: { organizationId, status: { in: ['open', 'awaiting_student'] } } }),
    includeJobs ? prisma.backgroundJob.count({ where: { status: 'dead' } }) : Promise.resolve(0),
  ]);
  const line = (label: string, rows: Array<{ status: string; _count: { _all: number } }>) => `${label}: ${rows.length ? rows.map(r => `${r._count._all} ${r.status}`).join(', ') : 'none'}`;
  return [line('Exams', exams), line('Attempts', attempts), line('Results', grades), `Incidents awaiting a human decision: ${openIncidents}`, ...(includeJobs ? [`Background jobs that exhausted retries: ${failedJobs}`] : [])];
}

export function registerOpsRoutes(app: Express) {
  const provider = providerFromEnv();
  const assistant = createAssistant({ provider });
  const chatLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, keyGenerator: req => (req as AuthRequest).auth?.userId ?? 'anonymous' });

  app.get('/api/organizations/:organizationId/assistant/status', authenticate, authorize('institute_admin', 'teacher', 'proctor', 'student'), (_req, res) => {
    res.json({ mode: provider ? 'ai_assisted' : 'help_center', providerConfigured: !!provider, conversationsStored: false });
  });

  app.post('/api/organizations/:organizationId/assistant/chat', authenticate, authorize('institute_admin', 'teacher', 'proctor', 'student'), chatLimiter, async (req: AuthRequest, res, next) => { try {
    const body = chatBody.parse(req.body);
    const role = assistantRoleFor(req.auth!.role);
    if (!role) return res.status(403).json({ error: 'Assistant is not available for this role' });
    const userId = req.auth!.userId; const organizationId = req.auth!.organizationId!; const now = new Date();
    // Active-exam state comes from the database, in ANY organization the user belongs to; the client cannot claim otherwise.
    const examActive = !!(await prisma.examAttempt.findFirst({ where: { userId, OR: [{ status: 'paused' }, { status: 'in_progress', deadlineAt: { gt: now } }] }, select: { id: true } }));
    const wantsFacts = role !== 'candidate' && classifyIntent(body.message) === 'analytics';
    const reply = await assistant.respond({ role, userId, message: body.message, history: body.history, examActive, facts: wantsFacts ? await organizationFacts(organizationId, role === 'admin') : undefined });
    // Content is never stored. Only the refusal category is audited, and it is not a finding about the person.
    if (reply.mode === 'refused' && AUDITED_REFUSALS.has(reply.intent)) await prisma.auditLog.create({ data: { organizationId, actorId: userId, action: 'assistant.refused', targetType: 'Assistant', targetId: userId, metadata: { intent: reply.intent, examActive, note: 'Automated policy refusal; not a misconduct finding.' } } });
    res.json(reply);
  } catch (error) { next(error); } });

  // Feedback records only the rating and the answer's category. The question and answer text are never stored.
  const feedbackBody = z.object({ helpful: z.boolean(), intent: z.string().max(40), mode: z.enum(['knowledge', 'model', 'refused', 'no_answer', 'rate_limited']) });
  app.post('/api/organizations/:organizationId/assistant/feedback', authenticate, authorize('institute_admin', 'teacher', 'proctor', 'student'), chatLimiter, async (req: AuthRequest, res, next) => { try {
    const body = feedbackBody.parse(req.body);
    await prisma.auditLog.create({ data: { organizationId: req.auth!.organizationId!, actorId: req.auth!.userId, action: 'assistant.feedback', targetType: 'Assistant', targetId: req.auth!.userId, metadata: body } });
    res.status(204).end();
  } catch (error) { next(error); } });

  app.get('/api/organizations/:organizationId/operations/jobs', authenticate, authorize('institute_admin'), async (req: AuthRequest, res, next) => { try {
    const organizationId = req.auth!.organizationId!;
    const [byStatus, recentProblems, lastRuns, emailRows, emailFailures] = await Promise.all([
      prisma.backgroundJob.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.backgroundJob.findMany({ where: { OR: [{ status: 'dead' }, { status: 'queued', attempts: { gt: 0 } }] }, orderBy: { updatedAt: 'desc' }, take: 20, select: { id: true, type: true, status: true, attempts: true, maxAttempts: true, runAt: true, updatedAt: true, lastError: true } }),
      prisma.backgroundJob.findMany({ where: { status: 'succeeded' }, orderBy: { updatedAt: 'desc' }, take: 50, select: { type: true, updatedAt: true } }),
      prisma.emailOutbox.groupBy({ by: ['status'], where: { organizationId }, _count: { _all: true } }),
      prisma.emailOutbox.findMany({ where: { organizationId, status: 'failed' }, orderBy: { updatedAt: 'desc' }, take: 10, select: { id: true, template: true, attempts: true, updatedAt: true, lastError: true } }),
    ]);
    const lastSuccess: Record<string, Date> = {};
    for (const r of lastRuns) if (!lastSuccess[r.type]) lastSuccess[r.type] = r.updatedAt;
    // Sweeps are platform-wide and carry no tenant data; error text is sanitised before it is stored.
    res.json({ counts: Object.fromEntries(byStatus.map(r => [r.status, r._count._all])), recentProblems, lastSuccess, email: { configured: !!emailProviderFromEnv(), counts: Object.fromEntries(emailRows.map(r => [r.status, r._count._all])), recentFailures: emailFailures }, retentionDays: parseRetentionDays(process.env.EVIDENCE_RETENTION_DAYS) ?? null });
  } catch (error) { next(error); } });

  app.get('/api/organizations/:organizationId/operations/storage', authenticate, authorize('institute_admin'), async (req: AuthRequest, res, next) => { try {
    const organizationId = req.auth!.organizationId!; const days = parseRetentionDays(process.env.EVIDENCE_RETENTION_DAYS);
    const withEvidence = { organizationId, evidenceKey: { not: null } };
    const [items, oldest, pastRetention, tracked] = await Promise.all([
      prisma.proctoringEvent.count({ where: withEvidence }),
      prisma.proctoringEvent.findFirst({ where: withEvidence, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
      days ? prisma.proctoringEvent.count({ where: { ...withEvidence, createdAt: { lt: retentionCutoff(new Date(), days) } } }) : Promise.resolve(null),
      prisma.evidenceObject.aggregate({ where: { organizationId }, _sum: { sizeBytes: true }, _count: { _all: true } }),
    ]);
    const usedBytes = tracked._sum.sizeBytes ?? 0; const quotaBytes = parseQuotaBytes(process.env.EVIDENCE_ORG_QUOTA_MB);
    const quota = evaluateQuota({ usedBytes, quotaBytes });
    res.json({ storageConfigured: Boolean(req.app.get('storage')?.storageConfigured?.()), evidenceItems: items, oldestEvidenceAt: oldest?.createdAt ?? null, retentionDays: days ?? null, itemsPastRetention: pastRetention, trackedObjects: tracked._count._all, bytesUsed: usedBytes, quotaBytes: quotaBytes ?? null, quotaStatus: quota.status, percentUsed: quota.percentUsed, bytesNote: 'Counts objects uploaded since size tracking was added; use your storage provider metrics for total capacity.', autoDeletes: false });
  } catch (error) { next(error); } });

  app.get('/api/organizations/:organizationId/evidence/:kind/:evidenceId/access-log', authenticate, authorize(...reviewerRoles), async (req: AuthRequest, res, next) => { try {
    const evidenceId = String(req.params.evidenceId);
    if (!isUuid(evidenceId)) return res.status(400).json({ error: 'Invalid evidence id' });
    const rows = await prisma.auditLog.findMany({ where: { organizationId: req.auth!.organizationId!, targetId: evidenceId, action: { startsWith: 'evidence.' } }, orderBy: { createdAt: 'desc' }, take: 100, select: { action: true, createdAt: true, actor: { select: { name: true } } } });
    res.json({ accessLog: rows.map(r => ({ action: r.action, at: r.createdAt, by: r.actor?.name ?? 'System' })) });
  } catch (error) { next(error); } });

  app.get('/api/organizations/:organizationId/attempts/:attemptId/companion-status', authenticate, authorize(...reviewerRoles), async (req: AuthRequest, res, next) => { try {
    const organizationId = req.auth!.organizationId!; const attemptId = String(req.params.attemptId);
    if (!isUuid(attemptId)) return res.status(400).json({ error: 'Invalid attempt id' });
    if (!(await prisma.examAttempt.findFirst({ where: { id: attemptId, organizationId }, select: { id: true } }))) return res.status(404).json({ error: 'Attempt not found' });
    const [latest, byStatus] = await Promise.all([
      prisma.radioObservation.findFirst({ where: { organizationId, attemptId }, orderBy: { observedAt: 'desc' }, select: { observedAt: true, scannerStatus: true, errorCode: true } }),
      prisma.radioObservation.groupBy({ by: ['scannerStatus'], where: { organizationId, attemptId }, _count: { _all: true } }),
    ]);
    // Diagnostics only: no pseudonyms, fingerprints or signal data are returned.
    res.json({ connection: companionConnection(latest && { observedAt: latest.observedAt, scannerStatus: latest.scannerStatus }, new Date()), lastObservationAt: latest?.observedAt ?? null, lastScannerStatus: latest?.scannerStatus ?? null, lastErrorCode: latest?.errorCode ?? null, scannerStatusCounts: Object.fromEntries(byStatus.map(r => [r.scannerStatus, r._count._all])), note: 'Companion observations are evidence for human review, not proof of misconduct.' });
  } catch (error) { next(error); } });

  // Candidate-facing readiness: only the candidate who owns the attempt can see it, and only technical status is returned.
  app.get('/api/student/attempts/:attemptId/companion-status', authenticate, async (req: AuthRequest, res, next) => { try {
    const attemptId = String(req.params.attemptId);
    if (!isUuid(attemptId)) return res.status(400).json({ error: 'Invalid attempt id' });
    const attempt = await prisma.examAttempt.findFirst({ where: { id: attemptId, userId: req.auth!.userId }, select: { id: true, organizationId: true } });
    if (!attempt) return res.status(404).json({ error: 'Attempt not found' });
    const latest = await prisma.radioObservation.findFirst({ where: { organizationId: attempt.organizationId, attemptId: attempt.id }, orderBy: { observedAt: 'desc' }, select: { observedAt: true, scannerStatus: true } });
    res.json(companionConnection(latest, new Date()));
  } catch (error) { next(error); } });
}
