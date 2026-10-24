import express from 'express';
import crypto from 'node:crypto';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { authenticate, authenticateCompanion, authorize, signCompanionToken, signToken, tenantFilter, type AuthRequest, type CompanionClaims } from './auth.js';
import { canStartExam, deadlineFor, isAttemptOpen } from './exam.js';
import { privateDocumentUrl, putPrivateDocument, storageConfigured } from './storage.js';
import { dedupeWindow, fingerprintFor, reviewPriority } from './proctor.js';
import { automaticallyGrade } from './grading.js';
import { createResetToken, hashResetToken, passwordPolicy } from './password-reset.js';
import { sendPasswordResetEmail } from './mailer.js';
import { loadConfig } from './config.js';
import { regionsForCountry, searchDirectory } from './institutions.js';
import { interventionFor } from './intervention.js';
import { beginAuthorization, configuredProviders, finishAuthorization, type OAuthProvider } from './oauth.js';
import { prisma } from './prisma.js';
import { Prisma } from './generated/prisma/client.js';
import { isUuid } from './ids.js';
import { examToJson, policyOf } from './serializers.js';
import { validateAnswerValue } from './answers.js';

const registration = z.object({ name: z.string().min(2), email: z.string().email().transform(value => value.toLowerCase()), password: z.string().min(10), organizationName: z.string().min(2) });
const credentials = z.object({ email: z.string().email().transform(value => value.toLowerCase()), password: z.string().min(1) });
const resetRequest = z.object({ email: z.string().email().transform(value => value.toLowerCase()) });
const resetPassword = z.object({ token: z.string().min(20).max(200), password: z.string().min(10), confirmPassword: z.string() }).refine(data => data.password === data.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] });
const examInput = z.object({ title: z.string().min(3), instructions: z.string().max(10000).default(''), durationMinutes: z.number().int().positive().default(60), startsAt: z.string().datetime().optional(), endsAt: z.string().datetime().optional(), randomizeQuestions: z.boolean().default(false), randomizeOptions: z.boolean().default(false), requireVerification: z.boolean().default(true), interventionPolicy: z.object({ windowSeconds: z.number().int().min(30).max(3600).default(300), warningAt: z.number().int().min(1).default(1), pauseAt: z.number().int().min(2).default(3), terminateAt: z.number().int().min(3).default(5), automaticTerminationEnabled: z.boolean().default(false), fullscreenRequired: z.boolean().default(false) }).default({ windowSeconds: 300, warningAt: 1, pauseAt: 3, terminateAt: 5, automaticTerminationEnabled: false, fullscreenRequired: false }), accessCode: z.string().min(4).optional() });
const questionInput = z.object({ type: z.enum(['mcq', 'multiple_select', 'true_false', 'short_answer', 'descriptive']), prompt: z.string().min(1), options: z.array(z.object({ id: z.string(), text: z.string() })).default([]), correctAnswer: z.unknown().optional(), marks: z.number().positive(), negativeMarks: z.number().min(0).default(0) });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (_req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'application/pdf'].includes(file.mimetype)) });
const audit = (organizationId: string, actorId: string, action: string, targetType: string, targetId: string, metadata?: unknown) => prisma.auditLog.create({ data: { organizationId, actorId, action, targetType, targetId, metadata: metadata as Prisma.InputJsonValue | undefined } });
const notify = (organizationId: string, userId: string, type: string, title: string, body: string, metadata?: unknown) => prisma.notification.create({ data: { organizationId, userId, type, title, body, metadata: metadata as Prisma.InputJsonValue | undefined, delivery: 'email_unconfigured' } });
const questionFields = (data: z.infer<typeof questionInput>, clearMissing = false) => ({
  type: data.type,
  prompt: data.prompt,
  options: data.options,
  correctAnswer: data.correctAnswer == null ? (clearMissing ? Prisma.DbNull : undefined) : (data.correctAnswer as Prisma.InputJsonValue),
  marks: data.marks,
  negativeMarks: data.negativeMarks
});
const orgConfig = (organizationId: string) => prisma.proctoringConfig.upsert({ where: { organizationId }, update: {}, create: { organizationId } });
const shuffle = <T>(items: T[]) => { const copy = [...items]; for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; } return copy; };
const proctorEventInput = z.object({ examId: z.string().uuid(), candidateId: z.string().uuid(), sessionId: z.string().uuid().optional(), attemptId: z.string().uuid(), type: z.enum(['face_missing', 'multiple_faces', 'looking_away', 'phone_detected', 'visibility_hidden', 'fullscreen_exit', 'network_interruption', 'camera_permission_lost']), occurredAt: z.string().datetime(), source: z.literal('browser'), details: z.record(z.unknown()).optional(), evidenceKey: z.string().max(512).optional() });
const radioObservationInput = z.object({ organizationId: z.string().uuid(), examId: z.string().uuid(), candidateId: z.string().uuid(), attemptId: z.string().uuid(), source: z.enum(['bluetooth_le', 'wifi', 'scanner_health']), kind: z.enum(['advertisement', 'access_point', 'scan_unavailable', 'permission_denied', 'scan_error', 'scan_stopped']), rssi: z.number().int().min(-127).max(0).optional(), pseudonym: z.string().min(16).max(128).optional(), scannerStatus: z.enum(['active', 'unavailable', 'permission_denied', 'stopped', 'error']), errorCode: z.string().max(120).optional() }).superRefine((data, ctx) => { if (data.kind === 'advertisement' || data.kind === 'access_point') { if (!data.pseudonym) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A session-scoped pseudonym is required for a radio observation' }); if (data.scannerStatus !== 'active') ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Radio observations require an active scanner status' }); } });
export const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: process.env.CLIENT_URL ?? 'http://localhost:5173' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use(express.json());
app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.use('/api/auth', rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false }));
const passwordResetLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false });
const directoryLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
const radioObservationLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false });
app.use('/api', rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: 'draft-7', legacyHeaders: false }));
for (const name of ['organizationId', 'examId', 'candidateId', 'attemptId', 'questionId', 'incidentId', 'signalId', 'gradeId', 'id']) {
  app.param(name, (_req, res, next, value) => (isUuid(value) ? next() : res.status(404).json({ error: 'Not found' })));
}
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/api/auth/providers', (_req, res) => { const providers = configuredProviders(); res.json({ providers, status: providers.length ? 'configured' : 'not_configured', message: providers.length ? undefined : 'Google or Microsoft credentials have not been configured by this institution.' }); });
app.get('/api/auth/oauth/:provider/start', async (req, res, next) => { try {
  const provider = z.enum(['google', 'microsoft']).parse(req.params.provider) as OAuthProvider;
  const redirectUri = `${loadConfig().API_BASE_URL.replace(/\/$/, '')}/api/auth/oauth/${provider}/callback`;
  const { url, state, nonce, codeVerifier } = await beginAuthorization(provider, redirectUri);
  await prisma.oAuthAuthorization.create({ data: { provider, state, nonce, codeVerifier, expiresAt: new Date(Date.now() + 10 * 60_000) } });
  res.redirect(303, url);
} catch (error) { next(error); } });
app.get('/api/auth/oauth/:provider/callback', async (req, res) => { try {
  const provider = z.enum(['google', 'microsoft']).parse(req.params.provider) as OAuthProvider;
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const stored = await prisma.oAuthAuthorization.delete({ where: { state } }).catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return null;
    throw error;
  });
  if (!stored || stored.provider !== provider || stored.expiresAt <= new Date()) return res.status(400).send('This sign-in request has expired or is invalid. Please return to ExamGuard and try again.');
  const config = loadConfig();
  const redirectUri = `${config.API_BASE_URL.replace(/\/$/, '')}/api/auth/oauth/${provider}/callback`;
  const identity = await finishAuthorization(provider, redirectUri, `${config.API_BASE_URL.replace(/\/$/, '')}${req.originalUrl}`, stored.state, stored.nonce, stored.codeVerifier);
  const linked = await prisma.authIdentity.findUnique({ where: { provider_providerSubject: { provider, providerSubject: identity.subject } }, include: { user: true } });
  if (!linked) return res.status(403).send('This provider account is not linked to an ExamGuard account. Sign in with your password first and ask an administrator to link it.');
  const user = linked.user;
  const membership = await prisma.membership.findFirst({ where: { userId: user.id, active: true }, include: { organization: true }, orderBy: { createdAt: 'asc' } });
  if (!membership) return res.status(403).send('No active ExamGuard membership exists for this account.');
  const payload = Buffer.from(JSON.stringify({ token: signToken(user.id), user: { id: user.id, name: user.name, email: user.email }, organization: { id: membership.organization.id, name: membership.organization.name }, role: membership.role })).toString('base64url');
  res.redirect(303, `${config.CLIENT_URL.replace(/\/$/, '')}/login?oauth=${payload}`);
} catch { res.status(400).send('We could not complete provider sign-in. Verify the provider configuration and try again.'); } });
app.get('/api/public/institutions/regions', directoryLimiter, (req, res) => { const countryCode = typeof req.query.countryCode === 'string' ? req.query.countryCode : ''; if (!/^[A-Za-z]{2}$/.test(countryCode)) return res.status(400).json({ error: 'A two-letter country code is required' }); res.json({ countryCode: countryCode.toUpperCase(), regions: regionsForCountry(countryCode) }); });
app.get('/api/public/institutions/search', directoryLimiter, async (req, res) => { const country = typeof req.query.country === 'string' ? req.query.country.trim() : ''; const name = typeof req.query.name === 'string' ? req.query.name.trim() : ''; if (country.length < 2 || name.length < 2) return res.status(400).json({ error: 'Country and a two-character institution search are required' }); try { res.json({ source: 'hipolabs', results: await searchDirectory(country, name) }); } catch { res.status(503).json({ error: 'The public institution directory could not be reached after retrying. You can submit an institution review request below; this does not verify or create an institution.' }); } });
app.post('/api/public/institution-requests', directoryLimiter, async (req, res, next) => { try {
  const data = z.object({ name: z.string().min(2).max(200), countryCode: z.string().regex(/^[A-Za-z]{2}$/), region: z.string().max(120).optional(), website: z.string().url().optional(), details: z.string().max(2000).optional(), requesterEmail: z.string().email().transform(value => value.toLowerCase()) }).parse(req.body);
  const request = await prisma.institutionRequest.create({ data: { ...data, countryCode: data.countryCode.toUpperCase() } });
  res.status(201).json({ reference: request.id, status: request.status });
} catch (error) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return res.status(409).json({ error: 'A matching institution request already exists' });
  next(error);
} });
app.post('/api/auth/register', async (req, res, next) => { try {
  const data = registration.parse(req.body);
  if (!passwordPolicy(data.password)) return res.status(400).json({ error: 'Password must contain upper and lower case letters, a number, and be at least 10 characters.' });
  const exists = await prisma.user.findUnique({ where: { email: data.email }, select: { id: true } });
  if (exists) return res.status(409).json({ error: 'Email already registered' });
  const slug = data.organizationName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Math.random().toString(36).slice(2, 6);
  const user = await prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      passwordHash: await bcrypt.hash(data.password, 12),
      memberships: { create: { role: 'institute_admin', organization: { create: { name: data.organizationName, slug } } } }
    },
    include: { memberships: { include: { organization: true } } }
  });
  const { organization } = user.memberships[0];
  res.status(201).json({ token: signToken(user.id), user: { id: user.id, name: user.name, email: user.email }, organization: { id: organization.id, name: organization.name }, role: 'institute_admin' });
} catch (error) { next(error); } });
app.post('/api/auth/login', async (req, res, next) => { try {
  const data = credentials.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: data.email } });
  if (!user || !(await bcrypt.compare(data.password, user.passwordHash))) return res.status(401).json({ error: 'Invalid email or password' });
  const membership = await prisma.membership.findFirst({ where: { userId: user.id, active: true }, include: { organization: true }, orderBy: { createdAt: 'asc' } });
  if (!membership) return res.status(403).json({ error: 'No active organization membership' });
  res.json({ token: signToken(user.id), user: { id: user.id, name: user.name, email: user.email }, organization: { id: membership.organization.id, name: membership.organization.name }, role: membership.role });
} catch (error) { next(error); } });
app.post('/api/auth/password-reset/request', passwordResetLimiter, async (req, res, next) => { try {
  const { email } = resetRequest.parse(req.body);
  const generic = { message: 'If an account exists, password recovery instructions will be sent.' };
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || process.env.EMAIL_PROVIDER !== 'webhook' || !process.env.EMAIL_URL || !process.env.EMAIL_FROM) return res.status(202).json(generic);
  const token = createResetToken();
  const tokenHash = hashResetToken(token);
  const config = loadConfig();
  const resetLink = `${config.APP_BASE_URL.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
  const reset = await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 15 * 60_000) } });
  try { await sendPasswordResetEmail(user.email, resetLink); } catch { await prisma.passwordResetToken.delete({ where: { id: reset.id } }); }
  const membership = await prisma.membership.findFirst({ where: { userId: user.id, active: true } });
  if (membership) await audit(membership.organizationId, user.id, 'password_reset.requested', 'User', user.id);
  res.status(202).json(generic);
} catch (error) { next(error); } });
app.post('/api/auth/password-reset/confirm', passwordResetLimiter, async (req, res, next) => { try {
  const data = resetPassword.parse(req.body);
  if (!passwordPolicy(data.password)) return res.status(400).json({ error: 'Password must contain upper and lower case letters, a number, and be at least 10 characters.' });
  const tokenHash = hashResetToken(data.token);
  const passwordHash = await bcrypt.hash(data.password, 12);
  const userId = await prisma.$transaction(async tx => {
    const claimed = await tx.passwordResetToken.updateMany({ where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (claimed.count === 0) return null;
    const reset = await tx.passwordResetToken.findUniqueOrThrow({ where: { tokenHash } });
    await tx.user.update({ where: { id: reset.userId }, data: { passwordHash } });
    return reset.userId;
  });
  if (!userId) return res.status(400).json({ error: 'This password reset link is invalid, expired, or already used.' });
  const membership = await prisma.membership.findFirst({ where: { userId, active: true } });
  if (membership) await audit(membership.organizationId, userId, 'password_reset.completed', 'User', userId);
  res.json({ message: 'Password updated. Sign in with your new password.' });
} catch (error) { next(error); } });
app.get('/api/organizations/:organizationId/dashboard', authenticate, authorize('institute_admin', 'teacher', 'proctor'), async (req: AuthRequest, res, next) => { try {
  const organizationId = req.auth!.organizationId!;
  const [exams, candidates, verificationPending, openIncidents, incidents, activeSessions, pendingExplanations] = await Promise.all([
    prisma.exam.count({ where: { organizationId } }),
    prisma.candidate.count({ where: { organizationId } }),
    prisma.verificationRequest.count({ where: { organizationId, status: { in: ['submitted', 'resubmission_required'] } } }),
    prisma.incident.count({ where: { organizationId, status: 'open' } }),
    prisma.incident.findMany({ where: { organizationId, status: 'open' }, orderBy: { createdAt: 'desc' }, take: 5 }),
    prisma.examAttempt.count({ where: { organizationId, status: 'in_progress' } }),
    prisma.studentExplanation.count({ where: { organizationId, status: { in: ['requested', 'follow_up'] } } })
  ]);
  res.json({ stats: { exams, candidates, verificationPending, openIncidents, activeSessions, pendingExplanations }, incidents });
} catch (error) { next(error); } });
app.get('/api/system/status', authenticate, async (_req: AuthRequest, res) => res.json({ api: 'healthy', storage: storageConfigured() ? 'configured_not_verified' : 'unconfigured', aiService: process.env.AI_SERVICE_URL ? 'configured_not_verified' : 'unconfigured', email: 'unavailable_no_adapter' }));
app.get('/api/organizations/:organizationId/exams', authenticate, authorize('institute_admin', 'teacher', 'proctor'), async (req: AuthRequest, res, next) => { try {
  const exams = await prisma.exam.findMany({ where: tenantFilter(req.auth!.organizationId!), orderBy: { createdAt: 'desc' } });
  res.json(exams.map(examToJson));
} catch (error) { next(error); } });
app.post('/api/organizations/:organizationId/exams', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
  const { accessCode, interventionPolicy: policy, startsAt, endsAt, ...examData } = examInput.parse(req.body);
  const exam = await prisma.exam.create({
    data: {
      ...examData,
      startsAt: startsAt ? new Date(startsAt) : undefined,
      endsAt: endsAt ? new Date(endsAt) : undefined,
      accessCodeHash: accessCode ? await bcrypt.hash(accessCode, 12) : undefined,
      policyWindowSeconds: policy.windowSeconds,
      policyWarningAt: policy.warningAt,
      policyPauseAt: policy.pauseAt,
      policyTerminateAt: policy.terminateAt,
      policyAutomaticTerminationEnabled: policy.automaticTerminationEnabled,
      policyFullscreenRequired: policy.fullscreenRequired,
      organizationId: req.auth!.organizationId!,
      createdById: req.auth!.userId
    }
  });
  await audit(req.auth!.organizationId!, req.auth!.userId, 'exam.created', 'Exam', exam.id);
  res.status(201).json(examToJson(exam));
} catch (error) { next(error); } });
app.get('/api/organizations/:organizationId/exams/:examId', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
  const exam = await prisma.exam.findFirst({ where: { id: String(req.params.examId), organizationId: req.auth!.organizationId! } });
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  res.json(examToJson(exam));
} catch (error) { next(error); } });
app.put('/api/organizations/:organizationId/exams/:examId', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
  const { accessCode, interventionPolicy: policy, startsAt, endsAt, ...examData } = examInput.parse(req.body);
  const organizationId = req.auth!.organizationId!;
  const examId = String(req.params.examId);
  const updated = await prisma.exam.updateMany({
    where: { id: examId, organizationId, status: 'draft' },
    data: {
      ...examData,
      startsAt: startsAt ? new Date(startsAt) : null,
      endsAt: endsAt ? new Date(endsAt) : null,
      ...(accessCode ? { accessCodeHash: await bcrypt.hash(accessCode, 12) } : {}),
      policyWindowSeconds: policy.windowSeconds,
      policyWarningAt: policy.warningAt,
      policyPauseAt: policy.pauseAt,
      policyTerminateAt: policy.terminateAt,
      policyAutomaticTerminationEnabled: policy.automaticTerminationEnabled,
      policyFullscreenRequired: policy.fullscreenRequired
    }
  });
  if (updated.count === 0) return res.status(404).json({ error: 'Editable draft exam not found' });
  const exam = await prisma.exam.findUniqueOrThrow({ where: { id: examId } });
  await audit(organizationId, req.auth!.userId, 'exam.updated', 'Exam', exam.id);
  res.json(examToJson(exam));
} catch (error) { next(error); } });
app.get('/api/organizations/:organizationId/candidates', authenticate, authorize('institute_admin', 'teacher', 'proctor'), async (req: AuthRequest, res, next) => { try {
  res.json(await prisma.candidate.findMany({ where: { organizationId: req.auth!.organizationId! }, orderBy: { name: 'asc' } }));
} catch (error) { next(error); } });
app.get('/api/organizations/:organizationId/candidates/:candidateId', authenticate, authorize('institute_admin', 'teacher', 'proctor'), async (req: AuthRequest, res, next) => { try {
  const organizationId = req.auth!.organizationId!;
  const candidate = await prisma.candidate.findFirst({ where: { id: String(req.params.candidateId), organizationId }, select: { id: true, name: true, email: true, phone: true, externalId: true, emailVerifiedAt: true, phoneVerifiedAt: true, userId: true } });
  if (!candidate) return res.status(404).json({ error: 'Candidate not found' });
  const [verification, assignments, attempts, grades] = await Promise.all([
    prisma.verificationRequest.findUnique({ where: { organizationId_candidateId: { organizationId, candidateId: candidate.id } }, select: { id: true, status: true, submittedAt: true, reviewedAt: true, rejectionReason: true } }),
    prisma.examAssignment.findMany({ where: { organizationId, candidateId: candidate.id }, include: { exam: { select: { id: true, title: true, status: true, startsAt: true, endsAt: true, durationMinutes: true } } } }),
    prisma.examAttempt.findMany({ where: { organizationId, candidateId: candidate.id }, select: { id: true, examId: true, status: true, startedAt: true, submittedAt: true, deadlineAt: true, receiptCode: true } }),
    prisma.grade.findMany({ where: { organizationId, candidateId: candidate.id }, select: { id: true, examId: true, totalMarks: true, maxMarks: true, status: true, publishedAt: true } })
  ]);
  res.json({
    candidate: { id: candidate.id, name: candidate.name, email: candidate.email, phone: candidate.phone, externalId: candidate.externalId, emailVerifiedAt: candidate.emailVerifiedAt, phoneVerifiedAt: candidate.phoneVerifiedAt, accountLinked: Boolean(candidate.userId) },
    verification: verification ?? { status: 'not_submitted' },
    assessments: assignments.map(assignment => ({ exam: assignment.exam, attempt: attempts.find(attempt => attempt.examId === assignment.examId), grade: grades.find(grade => grade.examId === assignment.examId) }))
  });
} catch (error) { next(error); } });
app.post('/api/organizations/:organizationId/candidates', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
  const data = z.object({ name: z.string().min(2), email: z.string().email().transform(value => value.toLowerCase()), initialPassword: z.string().min(10), phone: z.string().optional() }).parse(req.body);
  if (!passwordPolicy(data.initialPassword)) return res.status(400).json({ error: 'Initial password must contain upper and lower case letters, a number, and be at least 10 characters.' });
  const organizationId = req.auth!.organizationId!;
  const [existingCandidate, existingUser] = await Promise.all([
    prisma.candidate.findUnique({ where: { organizationId_email: { organizationId, email: data.email } }, select: { id: true } }),
    prisma.user.findUnique({ where: { email: data.email }, select: { id: true } })
  ]);
  if (existingCandidate) return res.status(409).json({ error: 'A candidate with this email already exists in this organization.' });
  if (existingUser) return res.status(409).json({ error: 'This email already has an ExamGuard account. Use the existing account or the password-recovery flow; an administrator cannot replace its password here.' });
  const passwordHash = await bcrypt.hash(data.initialPassword, 12);
  const candidate = await prisma.$transaction(async tx => {
    const user = await tx.user.create({ data: { name: data.name, email: data.email, passwordHash, memberships: { create: { role: 'student', organizationId } } } });
    return tx.candidate.create({ data: { organizationId, name: data.name, email: data.email, phone: data.phone, userId: user.id } });
  });
  await audit(organizationId, req.auth!.userId, 'candidate.created', 'Candidate', candidate.id);
  res.status(201).json({ id: candidate.id, name: candidate.name, email: candidate.email, accountCreated: true });
} catch (error) { next(error); } });
app.post('/api/organizations/:organizationId/exams/:examId/publish', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
  const organizationId = req.auth!.organizationId!;
  const examId = String(req.params.examId);
  const draft = await prisma.exam.findFirst({ where: { id: examId, organizationId, status: 'draft' } });
  if (!draft) return res.status(404).json({ error: 'Draft exam not found' });
  const questionCount = await prisma.question.count({ where: { organizationId, examId } });
  if (!questionCount) return res.status(400).json({ error: 'Add at least one question before publishing this exam' });
  const published = await prisma.exam.updateMany({ where: { id: examId, organizationId, status: 'draft' }, data: { status: draft.startsAt && draft.startsAt > new Date() ? 'scheduled' : 'published' } });
  if (published.count === 0) return res.status(404).json({ error: 'Draft exam not found' });
  const exam = await prisma.exam.findUniqueOrThrow({ where: { id: examId } });
  await audit(organizationId, req.auth!.userId, 'exam.published', 'Exam', exam.id, { questionCount });
  res.json(examToJson(exam));
} catch (error) { next(error); } });
app.post('/api/organizations/:organizationId/exams/:examId/questions', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
  const data = questionInput.parse(req.body);
  const organizationId = req.auth!.organizationId!;
  const examId = String(req.params.examId);
  const exam = await prisma.exam.findFirst({ where: { id: examId, organizationId, status: 'draft' }, select: { id: true } });
  if (!exam) return res.status(404).json({ error: 'Draft exam not found' });
  const question = await prisma.question.create({ data: { ...questionFields(data), organizationId, examId, position: await prisma.question.count({ where: { examId } }) } });
  res.status(201).json(question);
} catch (error) { next(error); } });
app.delete('/api/organizations/:organizationId/exams/:examId/questions/:questionId', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
  const organizationId = req.auth!.organizationId!;
  const examId = String(req.params.examId);
  const exam = await prisma.exam.findFirst({ where: { id: examId, organizationId, status: 'draft' }, select: { id: true } });
  if (!exam) return res.status(404).json({ error: 'Editable draft exam not found' });
  const questionId = String(req.params.questionId);
  const removed = await prisma.question.deleteMany({ where: { id: questionId, organizationId, examId } });
  if (removed.count === 0) return res.status(404).json({ error: 'Editable draft question not found' });
  await audit(organizationId, req.auth!.userId, 'exam.question_removed', 'Question', questionId);
  res.status(204).end();
} catch (error) { next(error); } });
app.get('/api/organizations/:organizationId/exams/:examId/questions', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
  const examId = String(req.params.examId);
  res.json(await prisma.question.findMany({ where: { organizationId: req.auth!.organizationId!, examId }, orderBy: { position: 'asc' } }));
} catch (error) { next(error); } });
app.get('/api/organizations/:organizationId/question-banks', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
  res.json(await prisma.questionBank.findMany({ where: { organizationId: req.auth!.organizationId! }, orderBy: { name: 'asc' } }));
} catch (error) { next(error); } });
app.post('/api/organizations/:organizationId/question-banks', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
  const data = z.object({ name: z.string().min(2).max(160), description: z.string().max(1000).optional() }).parse(req.body);
  const organizationId = req.auth!.organizationId!;
  const bank = await prisma.questionBank.create({ data: { ...data, organizationId, createdById: req.auth!.userId } });
  await audit(organizationId, req.auth!.userId, 'question_bank.created', 'QuestionBank', bank.id);
  res.status(201).json(bank);
} catch (error) { next(error); } });
app.get('/api/organizations/:organizationId/question-banks/:bankId/questions', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
  res.json(await prisma.question.findMany({ where: { organizationId: req.auth!.organizationId!, bankId: String(req.params.bankId), examId: null }, orderBy: { createdAt: 'desc' } }));
} catch (error) { next(error); } });
app.post('/api/organizations/:organizationId/question-banks/:bankId/questions', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
  const data = questionInput.parse(req.body);
  const organizationId = req.auth!.organizationId!;
  const bankId = String(req.params.bankId);
  const bank = await prisma.questionBank.findFirst({ where: { id: bankId, organizationId }, select: { id: true } });
  if (!bank) return res.status(404).json({ error: 'Question bank not found' });
  const question = await prisma.question.create({ data: { ...questionFields(data), organizationId, bankId } });
  await audit(organizationId, req.auth!.userId, 'question_bank.question_created', 'Question', question.id);
  res.status(201).json(question);
} catch (error) { next(error); } });
app.put('/api/organizations/:organizationId/question-banks/:bankId/questions/:questionId', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
  const data = questionInput.parse(req.body);
  const organizationId = req.auth!.organizationId!;
  const questionId = String(req.params.questionId);
  const updated = await prisma.question.updateMany({ where: { id: questionId, organizationId, bankId: String(req.params.bankId), examId: null }, data: questionFields(data, true) });
  if (updated.count === 0) return res.status(404).json({ error: 'Editable question-bank question not found' });
  const question = await prisma.question.findUniqueOrThrow({ where: { id: questionId } });
  await audit(organizationId, req.auth!.userId, 'question_bank.question_updated', 'Question', question.id);
  res.json(question);
} catch (error) { next(error); } });
app.post('/api/organizations/:organizationId/exams/:examId/questions/from-bank/:questionId', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
  const organizationId = req.auth!.organizationId!;
  const examId = String(req.params.examId);
  const [exam, source] = await Promise.all([
    prisma.exam.findFirst({ where: { id: examId, organizationId, status: 'draft' }, select: { id: true } }),
    prisma.question.findFirst({ where: { id: String(req.params.questionId), organizationId, bankId: { not: null }, examId: null } })
  ]);
  if (!exam || !source) return res.status(404).json({ error: 'Draft exam or question-bank question not found' });
  const question = await prisma.question.create({
    data: {
      organizationId, examId, type: source.type, prompt: source.prompt,
      options: (source.options ?? undefined) as Prisma.InputJsonValue | undefined,
      correctAnswer: (source.correctAnswer ?? undefined) as Prisma.InputJsonValue | undefined,
      marks: source.marks, negativeMarks: source.negativeMarks,
      position: await prisma.question.count({ where: { examId } })
    }
  });
  await audit(organizationId, req.auth!.userId, 'exam.question_added_from_bank', 'Question', question.id, { sourceQuestionId: source.id });
  res.status(201).json(question);
} catch (error) { next(error); } });
app.post('/api/organizations/:organizationId/exams/:examId/assignments', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
  const { candidateId } = z.object({ candidateId: z.string().uuid() }).parse(req.body);
  const organizationId = req.auth!.organizationId!;
  const examId = String(req.params.examId);
  const [candidate, exam] = await Promise.all([
    prisma.candidate.findFirst({ where: { id: candidateId, organizationId }, select: { id: true } }),
    prisma.exam.findFirst({ where: { id: examId, organizationId, status: { in: ['published', 'scheduled', 'live'] } }, select: { id: true } })
  ]);
  if (!candidate || !exam) return res.status(404).json({ error: 'Candidate not found or assessment is not published' });
  const assignment = await prisma.examAssignment.upsert({
    where: { examId_candidateId: { examId: exam.id, candidateId: candidate.id } },
    update: {},
    create: { organizationId, examId: exam.id, candidateId: candidate.id }
  });
  res.status(201).json(assignment);
} catch (error) { next(error); } });
app.get('/api/student/dashboard', authenticate, async (req: AuthRequest, res, next) => { try {
  const memberships = await prisma.membership.findMany({ where: { userId: req.auth!.userId, active: true }, select: { organizationId: true } });
  const candidate = await prisma.candidate.findFirst({ where: { userId: req.auth!.userId, organizationId: { in: memberships.map(membership => membership.organizationId) } } });
  if (!candidate) return res.status(403).json({ error: 'Candidate access required' });
  const organizationId = candidate.organizationId;
  const [assignments, attempts, grades, verification] = await Promise.all([
    prisma.examAssignment.findMany({ where: { organizationId, candidateId: candidate.id }, include: { exam: { select: { id: true, title: true, status: true, startsAt: true, endsAt: true, durationMinutes: true, instructions: true, requireVerification: true } } } }),
    prisma.examAttempt.findMany({ where: { organizationId, candidateId: candidate.id }, select: { id: true, examId: true, status: true, startedAt: true, submittedAt: true, deadlineAt: true, receiptCode: true } }),
    prisma.grade.findMany({ where: { organizationId, candidateId: candidate.id, status: 'published' }, select: { id: true, examId: true, totalMarks: true, maxMarks: true, feedback: true, publishedAt: true } }),
    prisma.verificationRequest.findUnique({ where: { organizationId_candidateId: { organizationId, candidateId: candidate.id } }, select: { id: true, status: true, submittedAt: true, reviewedAt: true, rejectionReason: true } })
  ]);
  res.json({
    candidate: { id: candidate.id, name: candidate.name },
    verification: verification ?? { status: 'not_submitted' },
    assignments: assignments.map(assignment => ({ id: assignment.id, exam: assignment.exam, attempt: attempts.find(attempt => attempt.examId === assignment.examId), grade: grades.find(grade => grade.examId === assignment.examId) }))
  });
} catch (error) { next(error); } });
app.post('/api/organizations/:organizationId/candidates/:candidateId/verification', authenticate, async (req: AuthRequest, res, next) => { try {
  const organizationId = String(req.params.organizationId);
  const candidate = await prisma.candidate.findFirst({ where: { id: String(req.params.candidateId), organizationId, userId: req.auth!.userId } });
  if (!candidate) return res.status(403).json({ error: 'Candidate access required' });
  const verification = await prisma.verificationRequest.upsert({
    where: { organizationId_candidateId: { organizationId, candidateId: candidate.id } },
    update: { status: 'submitted', submittedAt: new Date(), rejectionReason: null },
    create: { organizationId, candidateId: candidate.id, status: 'submitted', submittedAt: new Date() }
  });
  await audit(organizationId, req.auth!.userId, 'verification.submitted', 'VerificationRequest', verification.id);
  res.json(verification);
} catch (error) { next(error); } });
app.post('/api/organizations/:organizationId/candidates/:candidateId/documents/:kind', authenticate, upload.single('file'), async (req: AuthRequest, res, next) => { try {
  const organizationId = String(req.params.organizationId);
  const kind = String(req.params.kind);
  const candidate = await prisma.candidate.findFirst({ where: { id: String(req.params.candidateId), organizationId, userId: req.auth!.userId } });
  if (!candidate || !req.file || !['photo', 'idDocument'].includes(kind)) return res.status(403).json({ error: 'Authorized file required' });
  const key = `organizations/${organizationId}/candidates/${candidate.id}/${kind}-${Date.now()}`;
  await putPrivateDocument(key, req.file.buffer, req.file.mimetype);
  const fileData = kind === 'photo' ? { profilePhoto: key } : { idDocument: key };
  const verification = await prisma.verificationRequest.upsert({
    where: { organizationId_candidateId: { organizationId, candidateId: candidate.id } },
    update: { ...fileData, status: 'draft' },
    create: { organizationId, candidateId: candidate.id, ...fileData, status: 'draft' }
  });
  await audit(organizationId, req.auth!.userId, 'verification.document_uploaded', 'VerificationRequest', verification.id, { kind });
  res.json({ status: verification.status });
} catch (error) { next(error); } });
app.get('/api/organizations/:organizationId/verifications', authenticate, authorize('institute_admin', 'teacher', 'proctor'), async (req: AuthRequest, res, next) => { try {
  const rows = await prisma.verificationRequest.findMany({ where: { organizationId: req.auth!.organizationId! }, include: { candidate: { select: { id: true, name: true, email: true, phone: true } } } });
  res.json(rows.map(({ candidate, ...row }) => ({ ...row, candidateId: candidate })));
} catch (error) { next(error); } });
app.post('/api/organizations/:organizationId/verifications/:id/review', authenticate, authorize('institute_admin', 'proctor'), async (req: AuthRequest, res, next) => { try {
  const data = z.object({ approved: z.boolean(), reason: z.string().max(1000).optional() }).parse(req.body);
  if (!data.approved && !data.reason) return res.status(400).json({ error: 'A rejection reason is required' });
  const organizationId = req.auth!.organizationId!;
  const id = String(req.params.id);
  const reviewed = await prisma.verificationRequest.updateMany({
    where: { id, organizationId, status: { in: ['submitted', 'resubmission_required'] } },
    data: { status: data.approved ? 'approved' : 'rejected', rejectionReason: data.approved ? null : data.reason, reviewedAt: new Date(), reviewedById: req.auth!.userId }
  });
  if (reviewed.count === 0) return res.status(404).json({ error: 'Verification not found' });
  const verification = await prisma.verificationRequest.findUniqueOrThrow({ where: { id } });
  await audit(organizationId, req.auth!.userId, data.approved ? 'verification.approved' : 'verification.rejected', 'VerificationRequest', verification.id, { reason: data.reason });
  res.json(verification);
} catch (error) { next(error); } });
app.post('/api/student/organizations/:organizationId/exams/:examId/start', authenticate, async (req: AuthRequest, res, next) => { try {
  const organizationId = String(req.params.organizationId);
  const examId = String(req.params.examId);
  const { accessCode } = (req.body ?? {}) as { accessCode?: string };
  const candidate = await prisma.candidate.findFirst({ where: { organizationId, userId: req.auth!.userId } });
  const exam = await prisma.exam.findFirst({ where: { id: examId, organizationId, status: { in: ['published', 'scheduled', 'live'] } } });
  if (!candidate || !exam) return res.status(403).json({ error: 'Authorized candidate and published exam required' });
  const assignment = await prisma.examAssignment.findUnique({ where: { examId_candidateId: { examId: exam.id, candidateId: candidate.id } }, select: { id: true } });
  if (!assignment || !canStartExam(new Date(), exam.startsAt ?? undefined, exam.endsAt ?? undefined)) return res.status(403).json({ error: 'This exam is not currently available' });
  if (exam.requireVerification) {
    const verification = await prisma.verificationRequest.findFirst({ where: { organizationId, candidateId: candidate.id, status: 'approved' }, select: { id: true } });
    if (!verification) return res.status(403).json({ error: 'Identity verification is required before starting' });
  }
  if (exam.accessCodeHash && !(accessCode && await bcrypt.compare(accessCode, exam.accessCodeHash))) return res.status(403).json({ error: 'Valid access code required' });
  let attempt = await prisma.examAttempt.findUnique({ where: { examId_candidateId: { examId: exam.id, candidateId: candidate.id } } });
  if (!attempt) {
    const questions = await prisma.question.findMany({ where: { organizationId, examId: exam.id }, select: { id: true }, orderBy: { position: 'asc' } });
    const order = exam.randomizeQuestions ? shuffle(questions.map(q => q.id)) : questions.map(q => q.id);
    const startedAt = new Date();
    try {
      attempt = await prisma.examAttempt.create({ data: { organizationId, examId: exam.id, candidateId: candidate.id, userId: req.auth!.userId, startedAt, deadlineAt: deadlineFor(startedAt, exam.durationMinutes, exam.endsAt ?? undefined), questionOrder: order } });
      await audit(organizationId, req.auth!.userId, 'attempt.started', 'ExamAttempt', attempt.id);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      attempt = await prisma.examAttempt.findUniqueOrThrow({ where: { examId_candidateId: { examId: exam.id, candidateId: candidate.id } } });
    }
  }
  if (!isAttemptOpen(attempt.status, attempt.deadlineAt)) return res.status(409).json({ error: 'Attempt is no longer open' });
  const rows = await prisma.question.findMany({ where: { id: { in: attempt.questionOrder }, organizationId } });
  const byId = new Map(rows.map(q => [q.id, q]));
  const questions = attempt.questionOrder.flatMap(id => { const q = byId.get(id); if (!q) return []; const options = Array.isArray(q.options) ? q.options : []; return [{ id: q.id, type: q.type, prompt: q.prompt, options: exam.randomizeOptions ? shuffle(options) : options, marks: q.marks }]; });
  const answers = await prisma.attemptAnswer.findMany({ where: { attemptId: attempt.id } });
  res.json({ attempt: { id: attempt.id, candidateId: candidate.id, examId: exam.id, deadlineAt: attempt.deadlineAt, status: attempt.status }, exam: { title: exam.title, instructions: exam.instructions }, questions, answers });
} catch (error) { next(error); } });
app.put('/api/student/attempts/:attemptId/answers/:questionId', authenticate, async (req: AuthRequest, res, next) => { try {
  const attempt = await prisma.examAttempt.findFirst({ where: { id: String(req.params.attemptId), userId: req.auth!.userId } });
  if (!attempt || !isAttemptOpen(attempt.status, attempt.deadlineAt)) return res.status(409).json({ error: 'Attempt is closed' });
  const question = await prisma.question.findFirst({ where: { id: String(req.params.questionId), examId: attempt.examId, organizationId: attempt.organizationId }, select: { id: true, type: true, options: true } });
  if (!question) return res.status(404).json({ error: 'Question not found' });
  const value = validateAnswerValue(question, req.body?.value);
  const savedAt = new Date();
  const answer = await prisma.attemptAnswer.upsert({
    where: { attemptId_questionId: { attemptId: attempt.id, questionId: question.id } },
    update: { value, savedAt },
    create: { attemptId: attempt.id, questionId: question.id, organizationId: attempt.organizationId, value, savedAt }
  });
  res.json({ savedAt: answer.savedAt });
} catch (error) { next(error); } });
app.post('/api/student/attempts/:attemptId/submit', authenticate, async (req: AuthRequest, res, next) => { try {
  const attempt = await prisma.examAttempt.findFirst({ where: { id: String(req.params.attemptId), userId: req.auth!.userId } });
  if (!attempt) return res.status(404).json({ error: 'Attempt not found' });
  if (attempt.status === 'submitted' || attempt.status === 'expired') return res.status(409).json({ error: 'Already submitted', receiptCode: attempt.receiptCode });
  if (attempt.status === 'paused' || attempt.status === 'terminated') return res.status(409).json({ error: `Attempt is ${attempt.status} and cannot be submitted by the candidate` });
  const receiptCode = `EG-${attempt.id.slice(-6).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
  const submittedAt = new Date();
  const status = submittedAt >= attempt.deadlineAt ? 'expired' : 'submitted';
  const closed = await prisma.examAttempt.updateMany({ where: { id: attempt.id, status: 'in_progress' }, data: { status, submittedAt, receiptCode } });
  if (closed.count === 0) return res.status(409).json({ error: 'Attempt state changed; please reload' });
  await audit(attempt.organizationId, req.auth!.userId, 'attempt.submitted', 'ExamAttempt', attempt.id, { status, receiptCode });
  res.json({ status, receiptCode, submittedAt });
} catch (error) { next(error); } });
app.get('/api/organizations/:organizationId/proctoring/config', authenticate, authorize('institute_admin', 'teacher', 'proctor'), async (req: AuthRequest, res, next) => { try {
  res.json(await orgConfig(req.auth!.organizationId!));
} catch (error) { next(error); } });
app.post('/api/student/attempts/:attemptId/evidence', authenticate, upload.single('file'), async (req: AuthRequest, res, next) => { try {
  if (!storageConfigured()) return res.status(503).json({ error: 'Private evidence storage is not configured' });
  const attempt = await prisma.examAttempt.findFirst({ where: { id: String(req.params.attemptId), userId: req.auth!.userId, status: 'in_progress', deadlineAt: { gt: new Date() } } });
  if (!attempt || !req.file || !['image/jpeg', 'image/png', 'image/webp'].includes(req.file.mimetype)) return res.status(403).json({ error: 'An active attempt and a JPEG, PNG, or WebP image are required' });
  const key = `organizations/${attempt.organizationId}/attempts/${attempt.id}/evidence/${crypto.randomUUID()}`;
  await putPrivateDocument(key, req.file.buffer, req.file.mimetype);
  res.status(201).json({ evidenceKey: key });
} catch (error) { next(error); } });
app.post('/api/organizations/:organizationId/proctoring/events', authenticate, async (req: AuthRequest, res, next) => { try {
  const data = proctorEventInput.parse(req.body);
  const organizationId = String(req.params.organizationId);
  const candidate = await prisma.candidate.findFirst({ where: { id: data.candidateId, organizationId, userId: req.auth!.userId } });
  const attempt = await prisma.examAttempt.findFirst({ where: { id: data.attemptId, organizationId, candidateId: data.candidateId, examId: data.examId, userId: req.auth!.userId, status: 'in_progress' } });
  const exam = await prisma.exam.findFirst({ where: { id: data.examId, organizationId } });
  if (!candidate || !attempt || !exam) return res.status(403).json({ error: 'An active authorized attempt is required' });
  if (data.evidenceKey && !data.evidenceKey.startsWith(`organizations/${organizationId}/attempts/${attempt.id}/evidence/`)) return res.status(403).json({ error: 'Evidence does not belong to this active attempt' });
  const policy = policyOf(exam);
  const occurredAt = new Date();
  const config = await orgConfig(organizationId);
  const fingerprint = fingerprintFor(organizationId, candidate.id, data.type, dedupeWindow(occurredAt, config.cooldownSeconds));
  if (await prisma.proctoringEvent.findFirst({ where: { organizationId, fingerprint }, select: { id: true } })) return res.status(202).json({ deduplicated: true });
  const windowStart = new Date(occurredAt.getTime() - policy.windowSeconds * 1000);
  const eventCount = await prisma.proctoringEvent.count({ where: { organizationId, attemptId: attempt.id, type: data.type, occurredAt: { gte: windowStart } } }) + 1;
  const action = interventionFor(policy, data.type, eventCount);
  const event = await prisma.proctoringEvent.create({ data: { organizationId, examId: data.examId, candidateId: candidate.id, sessionId: data.sessionId, attemptId: attempt.id, type: data.type, occurredAt, source: data.source, evidenceKey: data.evidenceKey, fingerprint, warningCount: eventCount, policyAction: action, details: data.details as Prisma.InputJsonValue | undefined } });
  const weight = Number((config.signalWeights as Record<string, number>)[data.type] ?? 0);
  const priority = reviewPriority([{ type: data.type, weight }]);
  const incident = await prisma.incident.create({
    data: {
      organizationId, examId: data.examId, candidateId: candidate.id, sessionId: data.sessionId, type: data.type,
      severity: priority.score >= 30 ? 'high' : priority.score >= 15 ? 'medium' : 'low',
      riskPriority: priority.score,
      contributingSignals: priority.contributingSignals.map(x => ({ ...x, eventId: event.id })),
      details: action === 'technical' ? `Technical event: ${data.type}` : `Automated signal: ${data.type}`,
      events: { create: { eventId: event.id } }
    }
  });
  if (action === 'paused' || action === 'terminated') {
    const changed = await prisma.examAttempt.updateMany({
      where: { id: attempt.id, status: 'in_progress' },
      data: action === 'paused' ? { status: 'paused', pausedAt: occurredAt, interventionReason: `Repeated ${data.type}` } : { status: 'terminated', terminatedAt: occurredAt, interventionReason: `Policy threshold reached for ${data.type}` }
    });
    if (changed.count === 0) return res.status(409).json({ error: 'Attempt state changed before intervention could be applied' });
    await audit(organizationId, req.auth!.userId, `attempt.${action}`, 'ExamAttempt', attempt.id, { eventType: data.type, eventCount });
  }
  await audit(organizationId, req.auth!.userId, 'proctoring.event_recorded', 'Incident', incident.id, { eventId: event.id, action, eventCount });
  const broadcast = app.get('broadcast') as undefined | ((room: string, payload: unknown) => void);
  broadcast?.(`org:${organizationId}:exam:${data.examId}`, { incidentId: incident.id, attemptId: attempt.id, type: event.type, action, warningCount: eventCount, occurredAt: event.occurredAt });
  res.status(201).json({ incidentId: incident.id, eventId: event.id, action, warningCount: eventCount, message: action === 'warning' ? `Warning ${eventCount}: follow your examination rules to continue.` : action === 'paused' ? 'Your attempt has been paused pending reviewer action.' : action === 'terminated' ? 'Your attempt has been ended under the configured examination policy.' : undefined });
} catch (error) { next(error); } });
app.post('/api/organizations/:organizationId/attempts/:attemptId/resume', authenticate, authorize('institute_admin', 'proctor'), async (req: AuthRequest, res, next) => { try {
  const data = z.object({ reason: z.string().min(3).max(2000) }).parse(req.body);
  const organizationId = req.auth!.organizationId!;
  const attemptId = String(req.params.attemptId);
  const resumed = await prisma.examAttempt.updateMany({ where: { id: attemptId, organizationId, status: 'paused', deadlineAt: { gt: new Date() } }, data: { status: 'in_progress', pausedAt: null, interventionReason: null } });
  if (resumed.count === 0) return res.status(404).json({ error: 'A resumable paused attempt was not found' });
  const attempt = await prisma.examAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  await audit(organizationId, req.auth!.userId, 'attempt.resumed', 'ExamAttempt', attempt.id, { reason: data.reason });
  res.json({ status: attempt.status, deadlineAt: attempt.deadlineAt });
} catch (error) { next(error); } });
app.post('/api/student/attempts/:attemptId/companion-pairing', authenticate, async (req: AuthRequest, res, next) => { try {
  const attempt = await prisma.examAttempt.findFirst({ where: { id: String(req.params.attemptId), userId: req.auth!.userId, status: 'in_progress', deadlineAt: { gt: new Date() } } });
  if (!attempt) return res.status(409).json({ error: 'An active exam attempt is required before a companion can be paired.' });
  const candidate = await prisma.candidate.findFirst({ where: { id: attempt.candidateId, organizationId: attempt.organizationId, userId: req.auth!.userId } });
  if (!candidate) return res.status(403).json({ error: 'Candidate authorization is required' });
  const token = signCompanionToken({ userId: req.auth!.userId, organizationId: attempt.organizationId, examId: attempt.examId, candidateId: candidate.id, attemptId: attempt.id });
  await audit(attempt.organizationId, req.auth!.userId, 'companion.pairing_issued', 'ExamAttempt', attempt.id);
  res.json({ pairingToken: token, expiresInSeconds: 600, context: { organizationId: attempt.organizationId, examId: attempt.examId, candidateId: candidate.id, attemptId: attempt.id } });
} catch (error) { next(error); } });
app.get('/api/student/companion-pairing', authenticateCompanion, async (req: AuthRequest, res, next) => { try {
  const companion = (req as AuthRequest & { companion: CompanionClaims }).companion;
  const attempt = await prisma.examAttempt.findFirst({ where: { id: companion.attemptId, organizationId: companion.organizationId, examId: companion.examId, candidateId: companion.candidateId, userId: companion.userId, status: 'in_progress', deadlineAt: { gt: new Date() } }, select: { id: true } });
  if (!attempt) return res.status(409).json({ error: 'This pairing is no longer active. Return to the active exam and generate a new pairing token.' });
  res.json({ context: { organizationId: companion.organizationId, examId: companion.examId, candidateId: companion.candidateId, attemptId: companion.attemptId }, expiresAt: companion.expiresAt ? new Date(companion.expiresAt * 1000).toISOString() : undefined });
} catch (error) { next(error); } });
app.post('/api/student/radio-observations', authenticateCompanion, radioObservationLimiter, async (req: AuthRequest, res, next) => { try {
  const data = radioObservationInput.parse(req.body);
  const companion = (req as AuthRequest & { companion: CompanionClaims }).companion;
  if (data.organizationId !== companion.organizationId || data.examId !== companion.examId || data.candidateId !== companion.candidateId || data.attemptId !== companion.attemptId) return res.status(403).json({ error: 'Observation context does not match this companion pairing.' });
  const candidate = await prisma.candidate.findFirst({ where: { id: data.candidateId, organizationId: companion.organizationId, userId: companion.userId } });
  const attempt = candidate && await prisma.examAttempt.findFirst({ where: { id: data.attemptId, organizationId: candidate.organizationId, candidateId: candidate.id, examId: data.examId, userId: companion.userId, status: 'in_progress', deadlineAt: { gt: new Date() } } });
  if (!candidate || !attempt) return res.status(403).json({ error: 'An active authorized attempt is required' });
  const organizationId = candidate.organizationId;
  const observedAt = new Date();
  const fingerprint = fingerprintFor(organizationId, attempt.id, `${data.source}:${data.kind}:${data.pseudonym ?? data.errorCode ?? 'health'}`, dedupeWindow(observedAt, 30));
  const limitations = data.source === 'bluetooth_le' ? 'BLE advertisements do not identify a device type; addresses may rotate and many phones do not advertise.' : data.source === 'wifi' ? 'Wi-Fi scans observe access points, not nearby clients or every phone; a hotspot is not proof of a prohibited device.' : 'Scanner health is technical telemetry and is not evidence of student conduct.';
  const fields = { examId: data.examId, candidateId: candidate.id, attemptId: attempt.id, source: data.source, kind: data.kind, rssi: data.rssi, pseudonym: data.pseudonym, scannerStatus: data.scannerStatus, errorCode: data.errorCode, observedAt, limitations, expiresAt: new Date(observedAt.getTime() + 30 * 24 * 60 * 60_000) };
  const observation = await prisma.radioObservation.upsert({ where: { organizationId_fingerprint: { organizationId, fingerprint } }, update: fields, create: { ...fields, organizationId, fingerprint } });
  let signalId: string | undefined;
  if (data.kind === 'advertisement' || data.kind === 'access_point') {
    const windowStart = new Date(observedAt.getTime() - 5 * 60_000);
    const recent = await prisma.radioObservation.findMany({ where: { organizationId, attemptId: attempt.id, source: data.source, kind: data.kind, observedAt: { gte: windowStart } }, orderBy: { observedAt: 'desc' }, take: 3 });
    if (recent.length >= 3) {
      const rule = `repeated_${data.source}_observation`;
      const existing = await prisma.radioCandidateSignal.findFirst({ where: { organizationId, attemptId: attempt.id, rule, status: 'pending_review' } });
      const signal = existing ?? await prisma.radioCandidateSignal.create({ data: { organizationId, examId: data.examId, candidateId: candidate.id, attemptId: attempt.id, rule, label: 'Repeated nearby radio observation — device type unknown', observations: { create: recent.map(x => ({ observationId: x.id })) } } });
      signalId = signal.id;
    }
  }
  await audit(organizationId, companion.userId, 'radio.observation_recorded', 'RadioObservation', observation.id, { source: data.source, kind: data.kind, signalId });
  res.status(201).json({ observationId: observation.id, candidateSignalId: signalId, disposition: data.kind === 'advertisement' || data.kind === 'access_point' ? 'recorded_for_possible_review' : 'technical_status_recorded' });
} catch (error) { next(error); } });
app.get('/api/organizations/:organizationId/radio-observations', authenticate, authorize('institute_admin', 'teacher', 'proctor'), async (req: AuthRequest, res, next) => { try {
  const organizationId = req.auth!.organizationId!;
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const [observations, signals] = await Promise.all([
    prisma.radioObservation.findMany({ where: { organizationId }, orderBy: { observedAt: 'desc' }, take: limit }),
    prisma.radioCandidateSignal.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' }, take: limit, include: { observations: { include: { observation: true } } } })
  ]);
  res.json({ observations, signals: signals.map(({ observations: links, ...signal }) => ({ ...signal, observationIds: links.map(link => link.observation) })) });
} catch (error) { next(error); } });
app.post('/api/organizations/:organizationId/radio-signals/:signalId/review', authenticate, authorize('institute_admin', 'teacher', 'proctor'), async (req: AuthRequest, res, next) => { try {
  const data = z.object({ status: z.enum(['reviewed_no_concern', 'reviewed_concern_retained', 'insufficient_evidence']), notes: z.string().min(3).max(2000) }).parse(req.body);
  const organizationId = req.auth!.organizationId!;
  const signalId = String(req.params.signalId);
  const reviewed = await prisma.radioCandidateSignal.updateMany({ where: { id: signalId, organizationId }, data: { status: data.status, reviewerNotes: data.notes, reviewerId: req.auth!.userId } });
  if (reviewed.count === 0) return res.status(404).json({ error: 'Radio candidate signal not found' });
  const signal = await prisma.radioCandidateSignal.findUniqueOrThrow({ where: { id: signalId } });
  await audit(organizationId, req.auth!.userId, 'radio.signal_reviewed', 'RadioCandidateSignal', signal.id, data);
  res.json(signal);
} catch (error) { next(error); } });
app.get('/api/organizations/:organizationId/incidents', authenticate, authorize('institute_admin', 'teacher', 'proctor'), async (req: AuthRequest, res, next) => { try {
  const incidents = await prisma.incident.findMany({
    where: { organizationId: req.auth!.organizationId! },
    orderBy: { createdAt: 'desc' },
    include: { events: { include: { event: true } }, candidate: { select: { id: true, name: true, email: true } }, exam: { select: { id: true, title: true } } }
  });
  res.json(await Promise.all(incidents.map(async ({ events, candidate, exam, ...incident }) => ({
    ...incident,
    candidateId: candidate ?? incident.candidateId,
    examId: exam ?? incident.examId,
    eventIds: await Promise.all(events.map(async ({ event }) => ({ ...event, evidenceUrl: event.evidenceKey && storageConfigured() ? await privateDocumentUrl(event.evidenceKey) : undefined })))
  }))));
} catch (error) { next(error); } });
app.post('/api/organizations/:organizationId/incidents/:incidentId/decision', authenticate, authorize('institute_admin', 'proctor'), async (req: AuthRequest, res, next) => { try {
  const data = z.object({ action: z.enum(['dismissed', 'resolved', 'escalated', 'awaiting_student']), reason: z.string().min(3).max(2000), notes: z.string().max(4000).optional() }).parse(req.body);
  const organizationId = req.auth!.organizationId!;
  const incidentId = String(req.params.incidentId);
  const config = await orgConfig(organizationId);
  const updated = await prisma.incident.updateMany({
    where: { id: incidentId, organizationId },
    data: { status: data.action, decisionReason: data.reason, reviewerNotes: data.notes, ...(data.action === 'awaiting_student' ? { explanationDeadlineAt: new Date(Date.now() + config.explanationDeadlineHours * 3600_000) } : {}) }
  });
  if (updated.count === 0) return res.status(404).json({ error: 'Incident not found' });
  const incident = await prisma.incident.findUniqueOrThrow({ where: { id: incidentId } });
  if (data.action === 'awaiting_student' && incident.candidateId) {
    await prisma.studentExplanation.upsert({
      where: { incidentId_candidateId: { incidentId: incident.id, candidateId: incident.candidateId } },
      update: { status: 'requested' },
      create: { organizationId, incidentId: incident.id, candidateId: incident.candidateId, status: 'requested' }
    });
  }
  await audit(organizationId, req.auth!.userId, `incident.${data.action}`, 'Incident', incident.id, { reason: data.reason, notes: data.notes });
  res.json(incident);
} catch (error) { next(error); } });
app.post('/api/student/incidents/:incidentId/explanation', authenticate, async (req: AuthRequest, res, next) => { try {
  const data = z.object({ body: z.string().min(3).max(5000) }).parse(req.body);
  const incident = await prisma.incident.findFirst({ where: { id: String(req.params.incidentId), status: 'awaiting_student' } });
  if (!incident || !incident.candidateId || (incident.explanationDeadlineAt && incident.explanationDeadlineAt < new Date())) return res.status(403).json({ error: 'Explanation is unavailable or past its deadline' });
  const candidate = await prisma.candidate.findFirst({ where: { id: incident.candidateId, organizationId: incident.organizationId, userId: req.auth!.userId } });
  if (!candidate) return res.status(403).json({ error: 'Student access required' });
  const explanation = await prisma.studentExplanation.update({ where: { incidentId_candidateId: { incidentId: incident.id, candidateId: candidate.id } }, data: { body: data.body, status: 'responded' } });
  await audit(incident.organizationId, req.auth!.userId, 'incident.explanation_submitted', 'Incident', incident.id);
  res.json(explanation);
} catch (error) { next(error); } });
app.post('/api/organizations/:organizationId/attempts/:attemptId/grade', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
  const organizationId = req.auth!.organizationId!;
  const attempt = await prisma.examAttempt.findFirst({ where: { id: String(req.params.attemptId), organizationId, status: { in: ['submitted', 'expired'] } } });
  if (!attempt) return res.status(404).json({ error: 'Submitted attempt not found' });
  const [questions, answers] = await Promise.all([
    prisma.question.findMany({ where: { organizationId, examId: attempt.examId } }),
    prisma.attemptAnswer.findMany({ where: { attemptId: attempt.id } })
  ]);
  const automatic = automaticallyGrade(questions, answers);
  const maxMarks = questions.reduce((total, q) => total + q.marks, 0);
  const status = automatic.needsManual ? 'pending_manual' : 'graded';
  const grade = await prisma.grade.upsert({
    where: { attemptId: attempt.id },
    update: { autoMarks: automatic.marks, totalMarks: automatic.marks, maxMarks, status },
    create: { organizationId, attemptId: attempt.id, examId: attempt.examId, candidateId: attempt.candidateId, autoMarks: automatic.marks, totalMarks: automatic.marks, maxMarks, status }
  });
  await audit(organizationId, req.auth!.userId, 'grade.auto_evaluated', 'Grade', grade.id);
  res.json(grade);
} catch (error) { next(error); } });
app.put('/api/organizations/:organizationId/grades/:gradeId/manual', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
  const data = z.object({ manualMarks: z.number().min(0), feedback: z.string().max(4000).optional() }).parse(req.body);
  const organizationId = req.auth!.organizationId!;
  const existing = await prisma.grade.findFirst({ where: { id: String(req.params.gradeId), organizationId } });
  if (!existing || existing.status === 'published') return res.status(404).json({ error: 'Editable grade not found' });
  const grade = await prisma.grade.update({ where: { id: existing.id }, data: { manualMarks: data.manualMarks, totalMarks: existing.autoMarks + data.manualMarks, feedback: data.feedback, status: 'graded' } });
  await audit(organizationId, req.auth!.userId, 'grade.manual_evaluated', 'Grade', grade.id);
  res.json(grade);
} catch (error) { next(error); } });
app.post('/api/organizations/:organizationId/grades/:gradeId/publish', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
  const organizationId = req.auth!.organizationId!;
  const gradeId = String(req.params.gradeId);
  const published = await prisma.grade.updateMany({ where: { id: gradeId, organizationId, status: 'graded' }, data: { status: 'published', publishedAt: new Date(), publishedById: req.auth!.userId } });
  if (published.count === 0) return res.status(404).json({ error: 'Graded result not found' });
  const grade = await prisma.grade.findUniqueOrThrow({ where: { id: gradeId } });
  const candidate = await prisma.candidate.findUnique({ where: { id: grade.candidateId } });
  if (candidate?.userId) await notify(organizationId, candidate.userId, 'result_published', 'Result published', 'Your exam result is now available.', { gradeId: grade.id });
  await audit(organizationId, req.auth!.userId, 'grade.published', 'Grade', grade.id);
  res.json(grade);
} catch (error) { next(error); } });
app.get('/api/organizations/:organizationId/reports/summary', authenticate, authorize('institute_admin', 'teacher', 'proctor'), async (req: AuthRequest, res, next) => { try {
  const organizationId = req.auth!.organizationId!;
  if (req.query.examId !== undefined && !isUuid(req.query.examId)) return res.status(400).json({ error: 'Invalid examId' });
  const examId = isUuid(req.query.examId) ? req.query.examId : undefined;
  const since = typeof req.query.from === 'string' ? new Date(req.query.from) : undefined;
  const byExam = examId ? { examId } : {};
  const attemptWhere = { organizationId, ...byExam, ...(since && !Number.isNaN(+since) ? { createdAt: { gte: since } } : {}) };
  const [assigned, attempts, submitted, incidents, verificationApproved, grades] = await Promise.all([
    prisma.examAssignment.count({ where: { organizationId, ...byExam } }),
    prisma.examAttempt.count({ where: attemptWhere }),
    prisma.examAttempt.count({ where: { ...attemptWhere, status: { in: ['submitted', 'expired'] } } }),
    prisma.incident.count({ where: { organizationId, ...byExam } }),
    prisma.verificationRequest.count({ where: { organizationId, status: 'approved' } }),
    prisma.grade.findMany({ where: { organizationId, ...byExam } })
  ]);
  res.json({ completionRate: assigned ? submitted / assigned : 0, submission: { assigned, attempts, submitted }, incidents, verificationApproved, grades: grades.map(g => ({ candidateId: g.candidateId, totalMarks: g.totalMarks, maxMarks: g.maxMarks, status: g.status })) });
} catch (error) { next(error); } });
app.get('/api/organizations/:organizationId/reports/export.csv', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
  const grades = await prisma.grade.findMany({ where: { organizationId: req.auth!.organizationId! }, include: { candidate: { select: { name: true } } } });
  const escape = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const csv = ['candidate,score,max_marks,status', ...grades.map(g => `${escape(g.candidate.name)},${g.totalMarks},${g.maxMarks},${g.status}`)].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="sentinelexam-results.csv"');
  res.send(csv);
} catch (error) { next(error); } });
app.get('/api/notifications', authenticate, async (req: AuthRequest, res, next) => { try {
  res.json({ emailConfigured: false, emailStatus: 'unavailable: no outbound email adapter is installed', notifications: await prisma.notification.findMany({ where: { userId: req.auth!.userId }, orderBy: { createdAt: 'desc' }, take: 50 }) });
} catch (error) { next(error); } });
app.post('/api/notifications/:id/read', authenticate, async (req: AuthRequest, res, next) => { try {
  const id = String(req.params.id);
  const marked = await prisma.notification.updateMany({ where: { id, userId: req.auth!.userId }, data: { readAt: new Date() } });
  if (marked.count === 0) return res.status(404).json({ error: 'Notification not found' });
  res.json(await prisma.notification.findUniqueOrThrow({ where: { id } }));
} catch (error) { next(error); } });
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input', details: error.flatten() });
  if (error instanceof multer.MulterError) return res.status(400).json({ error: 'Invalid upload' });
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'Already exists' });
    if (error.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    if (error.code === 'P2003') return res.status(400).json({ error: 'Referenced record does not exist' });
  }
  console.error(error);
  res.status(500).json({ error: 'Unexpected server error' });
});
