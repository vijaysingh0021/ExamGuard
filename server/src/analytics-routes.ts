import type { Express } from 'express';
import { authenticate, authorize, type AuthRequest } from './auth.js';
import { durations, parseDateParam, participation, questionPerformance, scores } from './analytics.js';
import { isUuid } from './ids.js';
import { prisma } from './prisma.js';

const ROW_CAP = 20_000;
const ANSWER_CAP = 100_000;

/** Every figure is computed from organization-scoped queries; nothing is estimated or sampled. */
export function registerAnalyticsRoutes(app: Express) {
  app.get('/api/organizations/:organizationId/reports/analytics', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
    const organizationId = req.auth!.organizationId!;
    if (req.query.examId !== undefined && !isUuid(req.query.examId)) return res.status(400).json({ error: 'Invalid examId' });
    const examId = isUuid(req.query.examId) ? req.query.examId : undefined;
    const from = parseDateParam(req.query.from), to = parseDateParam(req.query.to);
    if (from === 'invalid' || to === 'invalid') return res.status(400).json({ error: 'from and to must be ISO dates' });
    if (from && to && from > to) return res.status(400).json({ error: 'from must not be after to' });
    if (examId && !(await prisma.exam.findFirst({ where: { id: examId, organizationId }, select: { id: true } }))) return res.status(404).json({ error: 'Exam not found' });
    const byExam = examId ? { examId } : {};
    const range = from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {};
    const isAdmin = req.auth!.role === 'institute_admin';

    const [assigned, attempts, grades, incidentRows, evidenceItems, jobRows] = await Promise.all([
      prisma.examAssignment.count({ where: { organizationId, ...byExam } }),
      prisma.examAttempt.findMany({ where: { organizationId, ...byExam, ...range }, select: { status: true, startedAt: true, submittedAt: true }, take: ROW_CAP }),
      prisma.grade.findMany({ where: { organizationId, ...byExam, ...range }, select: { totalMarks: true, maxMarks: true, status: true }, take: ROW_CAP }),
      prisma.incident.groupBy({ by: ['status'], where: { organizationId, ...byExam, ...range }, _count: { _all: true } }),
      isAdmin ? prisma.proctoringEvent.count({ where: { organizationId, evidenceKey: { not: null } } }) : Promise.resolve(null),
      isAdmin ? prisma.backgroundJob.groupBy({ by: ['status'], _count: { _all: true } }) : Promise.resolve(null),
    ]);

    let questions: ReturnType<typeof questionPerformance> | null = null; let questionsTruncated = false;
    if (examId) {
      const finishedWhere = { examId, organizationId, status: { in: ['submitted', 'expired'] as Array<'submitted' | 'expired'> }, ...range };
      const [questionRows, answerRows, finished] = await Promise.all([
        prisma.question.findMany({ where: { organizationId, examId }, select: { id: true, type: true, prompt: true, position: true, correctAnswer: true } }),
        prisma.attemptAnswer.findMany({ where: { organizationId, attempt: finishedWhere }, select: { questionId: true, value: true }, take: ANSWER_CAP }),
        prisma.examAttempt.count({ where: finishedWhere }),
      ]);
      questionsTruncated = answerRows.length >= ANSWER_CAP;
      questions = questionPerformance(questionRows, answerRows, finished);
    }
    res.json({
      generatedAt: new Date().toISOString(), scope: { examId: examId ?? null, from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },
      participation: participation(assigned, attempts), durations: durations(attempts), scores: scores(grades),
      incidents: Object.fromEntries(incidentRows.map(r => [r.status, r._count._all])),
      questions, truncated: attempts.length >= ROW_CAP || grades.length >= ROW_CAP || questionsTruncated,
      operations: isAdmin ? { evidenceItems, jobs: Object.fromEntries((jobRows ?? []).map(r => [r.status, r._count._all])) } : null,
      notes: ['Assigned candidates are counted regardless of the date range.', 'Question performance covers objective questions in finished attempts and needs an exam selected.', 'Candidate groups are not part of the data model, so there is no group filter.'],
    });
  } catch (error) { next(error); } });
}
