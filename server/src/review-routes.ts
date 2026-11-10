import type { Express } from 'express';
import { authenticate, authorize, type AuthRequest } from './auth.js';
import { paginationHeaders, paginationOffset } from './organization-api.js';
import { prisma } from './prisma.js';
import { auditWhere, isUuidValue, parseAuditQuery, parseSubmissionQuery, projectReviewQuestion, submissionWhere } from './review-api.js';

const bad = (res: { status(c: number): { json(b: unknown): unknown } }, error: string) => res.status(400).json({ error });

/** Teacher/administrator read APIs that the existing grading endpoints need: who submitted, what they answered, and what happened. */
export function registerReviewRoutes(app: Express) {
  const examInOrg = (organizationId: string, examId: string) => prisma.exam.findFirst({ where: { id: examId, organizationId }, select: { id: true, title: true } });

  app.get('/api/organizations/:organizationId/exams/:examId/submissions', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
    const organizationId = req.auth!.organizationId!; const examId = String(req.params.examId);
    if (!isUuidValue(examId)) return bad(res, 'Invalid examId');
    const q = parseSubmissionQuery(req.query as Record<string, unknown>); if (!q.ok) return bad(res, q.error);
    if (!(await examInOrg(organizationId, examId))) return res.status(404).json({ error: 'Exam not found' });
    const where = submissionWhere(organizationId, examId, q.value) as any;
    const [total, attempts] = await Promise.all([
      prisma.examAttempt.count({ where }),
      prisma.examAttempt.findMany({ where, orderBy: [{ startedAt: 'desc' }, { id: 'asc' }], skip: paginationOffset(q.value.page, q.value.pageSize), take: q.value.pageSize,
        select: { id: true, status: true, startedAt: true, deadlineAt: true, submittedAt: true, receiptCode: true, candidate: { select: { id: true, name: true } }, grade: { select: { id: true, status: true, autoMarks: true, manualMarks: true, totalMarks: true, maxMarks: true } } } }),
    ]);
    res.set(paginationHeaders(q.value.page, q.value.pageSize, total));
    res.json(attempts);
  } catch (error) { next(error); } });

  app.get('/api/organizations/:organizationId/exams/:examId/submissions/summary', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
    const organizationId = req.auth!.organizationId!; const examId = String(req.params.examId);
    if (!isUuidValue(examId)) return bad(res, 'Invalid examId');
    if (!(await examInOrg(organizationId, examId))) return res.status(404).json({ error: 'Exam not found' });
    const [assigned, byStatus, byGrade, ungraded] = await Promise.all([
      prisma.examAssignment.count({ where: { organizationId, examId } }),
      prisma.examAttempt.groupBy({ by: ['status'], where: { organizationId, examId }, _count: { _all: true } }),
      prisma.grade.groupBy({ by: ['status'], where: { organizationId, examId }, _count: { _all: true } }),
      prisma.examAttempt.count({ where: { organizationId, examId, status: { in: ['submitted', 'expired'] }, grade: { is: null } } }),
    ]);
    res.json({ assigned, attempts: Object.fromEntries(byStatus.map(r => [r.status, r._count._all])), grades: Object.fromEntries(byGrade.map(r => [r.status, r._count._all])), awaitingEvaluation: ungraded });
  } catch (error) { next(error); } });

  // Viewing a candidate's answers is sensitive, so each view is audited.
  app.get('/api/organizations/:organizationId/attempts/:attemptId/review', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
    const organizationId = req.auth!.organizationId!; const attemptId = String(req.params.attemptId);
    if (!isUuidValue(attemptId)) return bad(res, 'Invalid attemptId');
    const attempt = await prisma.examAttempt.findFirst({ where: { id: attemptId, organizationId, status: { in: ['submitted', 'expired', 'terminated'] } }, select: { id: true, examId: true, status: true, startedAt: true, submittedAt: true, receiptCode: true, candidate: { select: { id: true, name: true } }, exam: { select: { title: true } }, grade: true } });
    if (!attempt) return res.status(404).json({ error: 'Finished attempt not found' });
    const [questions, answers] = await Promise.all([
      prisma.question.findMany({ where: { organizationId, examId: attempt.examId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
      prisma.attemptAnswer.findMany({ where: { organizationId, attemptId }, select: { questionId: true, value: true } }),
    ]);
    const answerOf = new Map(answers.map(a => [a.questionId, a.value]));
    await prisma.auditLog.create({ data: { organizationId, actorId: req.auth!.userId, action: 'attempt.reviewed', targetType: 'ExamAttempt', targetId: attemptId } });
    res.json({ attempt: { id: attempt.id, status: attempt.status, startedAt: attempt.startedAt, submittedAt: attempt.submittedAt, receiptCode: attempt.receiptCode, candidate: attempt.candidate, examTitle: attempt.exam.title }, grade: attempt.grade, questions: questions.map(q => projectReviewQuestion(q, answerOf.get(q.id))) });
  } catch (error) { next(error); } });

  app.get('/api/organizations/:organizationId/audit-logs', authenticate, authorize('institute_admin'), async (req: AuthRequest, res, next) => { try {
    const organizationId = req.auth!.organizationId!;
    const q = parseAuditQuery(req.query as Record<string, unknown>); if (!q.ok) return bad(res, q.error);
    if (q.value.from && q.value.to && q.value.from > q.value.to) return bad(res, 'from must not be after to');
    const where = auditWhere(organizationId, q.value);
    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: paginationOffset(q.value.page, q.value.pageSize), take: q.value.pageSize, select: { id: true, action: true, targetType: true, createdAt: true, actor: { select: { name: true } } } }),
    ]);
    // Metadata is intentionally not returned: it can hold identifiers and free-form detail not needed to understand who did what.
    res.set(paginationHeaders(q.value.page, q.value.pageSize, total));
    res.json(rows.map(r => ({ id: r.id, action: r.action, targetType: r.targetType, at: r.createdAt, by: r.actor?.name ?? 'System' })));
  } catch (error) { next(error); } });
}
