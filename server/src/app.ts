import express from 'express';
import crypto from 'node:crypto';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { authenticate, authenticateCompanion, authorize, signCompanionToken, signToken, tenantFilter, type AuthRequest, type CompanionClaims } from './auth.js';
import { canStartExam, deadlineFor, isAttemptOpen, submissionStatusAt } from './exam.js';
import { StorageInterface, realStorage, verifyLocalEvidenceToken } from './storage.js';
import { dedupeWindow, fingerprintFor, reviewPriority } from './proctor.js';
import { aiSignalsForFrame } from './ai-monitoring.js';
import { registerOpsRoutes } from './ops-routes.js';
import { registerReviewRoutes } from './review-routes.js';
import { registerEmailRoutes } from './email-routes.js';
import { emailProviderFromEnv } from './email.js';
import { registerAnalyticsRoutes } from './analytics-routes.js';
import { toCsv } from './csv.js';
import { evaluateQuota, parseQuotaBytes } from './quota.js';
import { securityHeaders } from './security-headers.js';
import { automaticallyGrade, gradeStatusAfterAuto, manualMarksWithinBounds, totalMarks } from './grading.js';
import { createOtp, createResetToken, hashResetToken, otpConfig, passwordPolicy } from './password-reset.js';
import { sendPasswordChangeConfirmationEmail, sendPasswordOtpEmail } from './mailer.js';
import { loadConfig } from './config.js';
import { regionsForCountry, searchDirectory } from './institutions.js';
import { beginAuthorization, configuredProviders, finishAuthorization, type OAuthProvider } from './oauth.js';
import { prisma } from './prisma.js';
import { Prisma } from './generated/prisma/client.js';
import { isUuid } from './ids.js';
import { examToJson, policyOf } from './serializers.js';
import { validateAnswerValue } from './answers.js';
import { explanationResponseOpen, incidentStatusForExplanation, validExplanationDeadline } from './explanation-workflow.js';
import { isSupportedImage, isSupportedIdentityDocument } from './upload-validation.js';
import { candidateListQuerySchema, candidateWhere, incidentListQuerySchema, incidentWhere, memberUpdateSchema, paginationHeaders, paginationOffset, questionOrderMatches, questionOrderSchema, memberCanBeManaged, wouldRemoveLastActiveAdmin, organizationApiRoles, prismaErrorResponse } from './organization-api.js';
import { evidenceInventoryQuerySchema, evidenceReviewerRoles, evidenceUrlTtlSeconds, incidentReviewStatus, radioReviewStatus, canTransitionIncident, canTransitionRadio, evidencePaginationHeaders, evidenceOffset, privateEvidenceMetadataError, evidenceKeyMatchesAttempt, evidenceAttemptScopeMatches, uploadErrorHttpStatus, signedEvidenceUrlExpiresAt, sanitizeEvidenceDetails } from './evidence-api.js';
export const validateFileContent = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const { mimetype, buffer } = req.file;

  if (!buffer || buffer.length === 0) {
    return res.status(400).json({ error: 'Invalid file' });
  }

  // Check if MIME type is supported
  if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(mimetype)) {
    return res.status(415).json({ error: 'Unsupported file type' });
  }

  // Validate file content matches declared MIME type
  if (mimetype === 'image/jpeg' && !isSupportedImage(mimetype, buffer)) {
    return res.status(422).json({ error: 'Invalid JPEG file content' });
  }

  if (mimetype === 'image/png' && !isSupportedImage(mimetype, buffer)) {
    return res.status(422).json({ error: 'Invalid PNG file content' });
  }

  if (mimetype === 'image/webp' && !isSupportedImage(mimetype, buffer)) {
    return res.status(422).json({ error: 'Invalid WebP file content' });
  }

  if (mimetype === 'application/pdf' && !isSupportedIdentityDocument(mimetype, buffer)) {
    return res.status(422).json({ error: 'Invalid PDF file content' });
  }

  next();
};
const validateOptionalFileContent = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!req.file) return next();
  return validateFileContent(req, res, next);
};

const registration = z.object({ name: z.string().min(2), email: z.string().email().transform(value => value.toLowerCase()), password: z.string().min(10), organizationName: z.string().min(2) });
const credentials = z.object({ email: z.string().email().transform(value => value.toLowerCase()), password: z.string().min(1) });
const resetRequest = z.object({ email: z.string().email().transform(value => value.toLowerCase()) });
const passwordResetOtp = resetRequest.extend({ otp: z.string().regex(/^\d{6}$/) });
const resetPassword = z.object({ token: z.string().min(20).max(200), password: z.string().min(10), confirmPassword: z.string() }).refine(data => data.password === data.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] });
const examInput = z.object({ title: z.string().min(3), instructions: z.string().max(10000).default(''), durationMinutes: z.number().int().positive().default(60), startsAt: z.string().datetime().optional(), endsAt: z.string().datetime().optional(), randomizeQuestions: z.boolean().default(false), randomizeOptions: z.boolean().default(false), requireVerification: z.boolean().default(true), interventionPolicy: z.object({ windowSeconds: z.number().int().min(30).max(3600).default(300), warningAt: z.number().int().min(1).default(1), pauseAt: z.number().int().min(2).default(3), terminateAt: z.number().int().min(3).default(5), automaticTerminationEnabled: z.boolean().default(false), fullscreenRequired: z.boolean().default(false) }).default({ windowSeconds: 300, warningAt: 1, pauseAt: 3, terminateAt: 5, automaticTerminationEnabled: false, fullscreenRequired: false }), accessCode: z.string().min(4).optional() });
const questionInput = z.object({ type: z.enum(['mcq', 'multiple_select', 'true_false', 'short_answer', 'descriptive']), prompt: z.string().min(1), options: z.array(z.object({ id: z.string(), text: z.string() })).default([]), correctAnswer: z.unknown().optional(), marks: z.number().positive(), negativeMarks: z.number().min(0).default(0) });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const audit = (organizationId: string, actorId: string, action: string, targetType: string, targetId: string, metadata?: unknown) => prisma.auditLog.create({ data: { organizationId, actorId, action, targetType, targetId, metadata: metadata as Prisma.InputJsonValue | undefined } });
const notify = (organizationId: string, userId: string, type: string, title: string, body: string, metadata?: unknown) => prisma.notification.create({ data: { organizationId, userId, type, title, body, metadata: metadata as Prisma.InputJsonValue | undefined, delivery: 'email_unconfigured' } });
const notifyOnce = async (organizationId: string, userId: string, type: string, title: string, body: string, metadata?: unknown) => {
  const explanationId = metadata && typeof metadata === 'object' && !Array.isArray(metadata) && 'explanationId' in metadata && typeof metadata.explanationId === 'string'
    ? metadata.explanationId
    : undefined;
  const existing = await prisma.notification.findFirst({
    where: {
      organizationId,
      userId,
      type,
      title,
      ...(explanationId ? { metadata: { path: ['explanationId'], equals: explanationId } } : {}),
    },
  });
  return existing ?? notify(organizationId, userId, type, title, body, metadata);
};
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
const proctorEventInput = z.object({ examId: z.string().uuid(), candidateId: z.string().uuid(), sessionId: z.string().uuid().optional(), attemptId: z.string().uuid(), type: z.enum(['face_missing', 'multiple_faces', 'looking_away', 'phone_detected', 'visibility_hidden', 'fullscreen_exit', 'window_blur', 'focus_regain', 'multiple_window_hint', 'network_interruption', 'camera_permission_lost']), occurredAt: z.string().datetime(), source: z.literal('browser'), details: z.record(z.unknown()).optional(), evidenceKey: z.string().max(512).optional() });
const radioObservationInput = z.object({ organizationId: z.string().uuid(), examId: z.string().uuid(), candidateId: z.string().uuid(), attemptId: z.string().uuid(), source: z.enum(['bluetooth_le', 'wifi', 'scanner_health']), kind: z.enum(['advertisement', 'access_point', 'heartbeat', 'scan_unavailable', 'permission_denied', 'scan_error', 'scan_stopped']), rssi: z.number().int().min(-127).max(0).optional(), pseudonym: z.string().min(16).max(128).optional(), scannerStatus: z.enum(['active', 'unavailable', 'permission_denied', 'stopped', 'error']), errorCode: z.string().max(120).optional() }).superRefine((data, ctx) => { if (data.kind === 'advertisement' || data.kind === 'access_point') { if (!data.pseudonym) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A session-scoped pseudonym is required for a radio observation' }); if (data.scannerStatus !== 'active') ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Radio observations require an active scanner status' }); } });

const aiFrameSchema = z.object({
  face_presence: z.boolean(),
  face_count: z.number().int().min(0).max(20),
  multiple_faces: z.boolean(),
  looking_away: z.enum(['looking_away', 'looking_forward', 'unavailable']),
  head_pose: z.object({ yaw_degrees: z.number(), pitch_degrees: z.number(), roll_degrees: z.number() }).nullable().optional(),
  phone_detection: z.enum(['detected', 'not_detected', 'unavailable']),
  phone_confidence: z.number().min(0).max(1).nullable().optional(),
  disclosure: z.string().max(1000).optional(),
  service_version: z.string().max(80).optional(),
  phone_model: z.string().max(40).optional()
}).strict();
const aiFrameLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });
export function createApp(storageImpl?: StorageInterface): express.Express {
  const app = express();
  const storage = storageImpl ?? realStorage;

  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(cors({ origin: process.env.CLIENT_URL ?? 'http://localhost:5173', exposedHeaders: ['X-Page', 'X-Page-Size', 'X-Total-Count', 'X-Total-Pages', 'Date'] }));
  app.set('storage', storage);
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
  const passwordResetLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false });
  const directoryLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
  const radioObservationLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false });
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: 'draft-7', legacyHeaders: false }));
  for (const name of ['organizationId', 'examId', 'candidateId', 'attemptId', 'questionId', 'incidentId', 'signalId', 'gradeId', 'userId', 'evidenceId', 'id']) {
    app.param(name, (_req, res, next, value) => (isUuid(value) ? next() : res.status(404).json({ error: 'Not found' })));
  }
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/local-evidence/:token', async (req, res) => {
    try {
      const key = verifyLocalEvidenceToken(String(req.params.token));
      if (!key.startsWith('organizations/')) return res.status(404).end();
      const object = await prisma.evidenceObject.findUnique({ where: { objectKey: key }, select: { organizationId: true, attemptId: true, mimeType: true, sizeBytes: true } });
      if (!object || !evidenceKeyMatchesAttempt(key, object.organizationId, object.attemptId)) return res.status(404).end();
      const storage = req.app.get('storage') as StorageInterface;
      if (!storage.getPrivateDocument) return res.status(404).end();
      const bytes = await storage.getPrivateDocument(key);
      if (!bytes || bytes.length !== object.sizeBytes) return res.status(404).end();
      res.set({ 'Content-Type': object.mimeType, 'Content-Length': String(bytes.length), 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' });
      return res.status(200).send(bytes);
    } catch {
      return res.status(404).end();
    }
  });

  app.get('/api/student/monitoring-readiness', authenticate, async (_req: AuthRequest, res) => {
    const serviceUrl = process.env.AI_SERVICE_URL;
    const serviceToken = process.env.AI_SERVICE_TOKEN;
    if (!serviceUrl || !serviceToken || serviceToken.length < 32) return res.status(503).json({ ready: false, aiService: 'not_configured', error: 'Configure AI_SERVICE_URL and a 32-character AI_SERVICE_TOKEN on the local server.' });
    try {
      const base = new URL(serviceUrl);
      if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) || !['http:', 'https:'].includes(base.protocol)) return res.status(503).json({ ready: false, aiService: 'invalid_local_url' });
      const response = await fetch(new URL('/health', base), { signal: AbortSignal.timeout(2500) });
      if (!response.ok) return res.status(503).json({ ready: false, aiService: 'unavailable' });
      const health = await response.json() as Record<string, unknown>;
      const ready = health.mediapipe === 'ready' && health.phone_model === 'ready' && health.looking_away === 'ready' && health.multiple_faces === 'ready';
      res.status(ready ? 200 : 503).json({ ready, aiService: ready ? 'ready' : 'models_unavailable', capabilities: { faceDetection: health.mediapipe === 'ready', phoneDetection: health.phone_model === 'ready', headOrientation: health.looking_away === 'ready', multipleFaces: health.multiple_faces === 'ready' }, note: 'Head orientation is an approximate review signal, not eye-gaze tracking.' });
    } catch {
      res.status(503).json({ ready: false, aiService: 'unavailable', error: 'Start the local ExamGuard AI service and check its model configuration.' });
    }
  });

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
    const payload = Buffer.from(JSON.stringify({ token: signToken(user.id, user.updatedAt.getTime()), user: { id: user.id, name: user.name, email: user.email }, organization: { id: membership.organization.id, name: membership.organization.name }, role: membership.role })).toString('base64url');
    // Fragments are not sent in HTTP requests, unlike query strings. This
    // keeps the short-lived session payload out of proxy/server logs and
    // referrer headers while the client exchanges it into local session state.
    res.redirect(303, `${config.CLIENT_URL.replace(/\/$/, '')}/login#oauth=${payload}`);
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
    const user = await prisma.user.create({ data: { name: data.name, email: data.email, passwordHash: await bcrypt.hash(data.password, 12), memberships: { create: { role: 'institute_admin', organization: { create: { name: data.organizationName, slug } } } } }, include: { memberships: { include: { organization: true } } } });
    const { organization } = user.memberships[0];
    res.status(201).json({ token: signToken(user.id, user.updatedAt.getTime()), user: { id: user.id, name: user.name, email: user.email }, organization: { id: organization.id, name: organization.name }, role: 'institute_admin' });
  } catch (error) { next(error); } });
  app.post('/api/auth/login', async (req, res, next) => { try {
    const data = credentials.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user || !(await bcrypt.compare(data.password, user.passwordHash))) return res.status(401).json({ error: 'Invalid email or password' });
    const membership = await prisma.membership.findFirst({ where: { userId: user.id, active: true }, include: { organization: true }, orderBy: { createdAt: 'asc' } });
    if (!membership) return res.status(403).json({ error: 'No active organization membership' });
    res.json({ token: signToken(user.id, user.updatedAt.getTime()), user: { id: user.id, name: user.name, email: user.email }, organization: { id: membership.organization.id, name: membership.organization.name }, role: membership.role });
  } catch (error) { next(error); } });
  app.post('/api/auth/password-reset/request', passwordResetLimiter, async (req, res, next) => { try {
    const { email } = resetRequest.parse(req.body);
    const generic = { message: 'If an account exists, a verification code will be sent.' };
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || process.env.EMAIL_PROVIDER !== 'webhook' || !process.env.EMAIL_URL || !process.env.EMAIL_FROM) return res.status(202).json(generic);
    const now = new Date();
    const config = otpConfig();
    const active = await prisma.passwordResetToken.findFirst({ where: { userId: user.id, usedAt: null }, orderBy: { createdAt: 'desc' } });
    if (active?.lastSentAt && now.getTime() - active.lastSentAt.getTime() < config.resendCooldownMs) return res.status(202).json(generic);
    const otp = createOtp();
    const reset = await prisma.passwordResetToken.upsert({
      where: { id: active?.id ?? crypto.randomUUID() },
      update: { tokenHash: hashResetToken(otp), expiresAt: new Date(now.getTime() + config.ttlMs), usedAt: null, otpAttempts: 0, lastSentAt: now, otpVerifiedAt: null },
      create: { userId: user.id, tokenHash: hashResetToken(otp), expiresAt: new Date(now.getTime() + config.ttlMs), lastSentAt: now },
    });
    try { await sendPasswordOtpEmail(user.email, otp); } catch { await prisma.passwordResetToken.delete({ where: { id: reset.id } }); console.warn('Password reset OTP delivery failed'); }
    const membership = await prisma.membership.findFirst({ where: { userId: user.id, active: true } });
    if (membership) await audit(membership.organizationId, user.id, 'password_reset.requested', 'User', user.id);
    res.status(202).json(generic);
  } catch (error) { next(error); } });
app.post('/api/auth/password-reset/verify', passwordResetLimiter, async (req, res, next) => { try {
  const data = passwordResetOtp.parse(req.body);
  const genericError = { error: 'The verification code is invalid, expired, or already used.' };
  const user = await prisma.user.findUnique({ where: { email: data.email } });
  const record = user ? await prisma.passwordResetToken.findFirst({ where: { userId: user.id, usedAt: null }, orderBy: { createdAt: 'desc' } }) : null;
  const config = otpConfig();
  if (!record || record.expiresAt <= new Date() || record.otpVerifiedAt || record.otpAttempts >= config.maxAttempts) return res.status(400).json(genericError);
  if (hashResetToken(data.otp) !== record.tokenHash) {
    await prisma.passwordResetToken.update({ where: { id: record.id }, data: { otpAttempts: { increment: 1 } } });
    return res.status(400).json(genericError);
  }
  const resetToken = createResetToken();
  await prisma.passwordResetToken.update({ where: { id: record.id }, data: { tokenHash: hashResetToken(resetToken), otpVerifiedAt: new Date(), expiresAt: new Date(Date.now() + config.ttlMs) } });
  res.json({ resetToken });
} catch (error) { next(error); } });
app.post('/api/auth/password-reset/confirm', passwordResetLimiter, async (req, res, next) => { try {
  const data = resetPassword.parse(req.body);
  if (!passwordPolicy(data.password)) return res.status(400).json({ error: 'Password must contain upper and lower case letters, a number, and be at least 10 characters.' });
  const tokenHash = hashResetToken(data.token);
  const passwordHash = await bcrypt.hash(data.password, 12);
  const result = await prisma.$transaction(async tx => {
    const reset = await tx.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!reset || reset.usedAt || !reset.otpVerifiedAt || reset.expiresAt <= new Date()) return null;
    const claimed = await tx.passwordResetToken.updateMany({ where: { id: reset.id, usedAt: null, otpVerifiedAt: { not: null } }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) return null;
    return tx.user.update({ where: { id: reset.userId }, data: { passwordHash }, select: { id: true, email: true } });
  });
  if (!result) return res.status(400).json({ error: 'This password reset session is invalid, expired, or already used.' });
  const membership = await prisma.membership.findFirst({ where: { userId: result.id, active: true } });
  if (membership) await audit(membership.organizationId, result.id, 'password_reset.completed', 'User', result.id);
  try { await sendPasswordChangeConfirmationEmail(result.email); } catch { console.warn('Password change confirmation delivery failed'); }
  res.json({ message: 'Password updated. Sign in with your new password.' });
} catch (error) { next(error); } });
app.get('/api/organizations/:organizationId/dashboard', authenticate, authorize('institute_admin', 'teacher', 'proctor'), async (req: AuthRequest, res, next) => { try {
  const organizationId = req.auth!.organizationId!;
  const [exams, candidates, verificationPending, openIncidents, incidents, activeSessions, pendingExplanations, awaitingEvaluation, pendingManual, readyToPublish] = await Promise.all([
    prisma.exam.count({ where: { organizationId } }),
    prisma.candidate.count({ where: { organizationId } }),
    prisma.verificationRequest.count({ where: { organizationId, status: { in: ['submitted', 'resubmission_required'] } } }),
    prisma.incident.count({ where: { organizationId, status: 'open' } }),
    prisma.incident.findMany({ where: { organizationId, status: 'open' }, orderBy: { createdAt: 'desc' }, take: 5 }),
    prisma.examAttempt.count({ where: { organizationId, status: 'in_progress' } }),
    prisma.studentExplanation.count({ where: { organizationId, status: { in: ['requested', 'follow_up'] } } }),
    prisma.examAttempt.count({ where: { organizationId, status: { in: ['submitted', 'expired'] }, grade: { is: null } } }),
    prisma.grade.count({ where: { organizationId, status: 'pending_manual' } }),
    prisma.grade.count({ where: { organizationId, status: 'graded' } })
  ]);
  res.json({ stats: { exams, candidates, verificationPending, openIncidents, activeSessions, pendingExplanations, awaitingEvaluation, pendingManual, readyToPublish }, incidents });
} catch (error) { next(error); } });
app.get('/api/system/status', authenticate, async (_req: AuthRequest, res) => {
  const storage = realStorage;
  res.json({ api: 'healthy', storage: storage.storageConfigured() ? 'configured_not_verified' : 'unconfigured', aiService: process.env.AI_SERVICE_URL ? 'configured_not_verified' : 'unconfigured', email: emailProviderFromEnv() ? 'configured_not_verified' : 'unconfigured' });
});
app.get('/api/organizations/:organizationId', authenticate, authorize('institute_admin', 'teacher', 'proctor'), async (req: AuthRequest, res, next) => { try {
  const organization = await prisma.organization.findFirst({ where: { id: req.auth!.organizationId! }, select: { id: true, name: true, slug: true, status: true, createdAt: true, updatedAt: true } });
  if (!organization) return res.status(404).json({ error: 'Organization not found' });
  res.json(organization);
} catch (error) { next(error); } });
app.patch('/api/organizations/:organizationId', authenticate, authorize('institute_admin'), async (req: AuthRequest, res, next) => { try {
  const data = z.object({ name: z.string().min(2).max(160), slug: z.string().min(2).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and hyphens only') }).parse(req.body);
  const organizationId = req.auth!.organizationId!;
  const changed = await prisma.organization.update({ where: { id: organizationId }, data });
  await audit(organizationId, req.auth!.userId, 'organization.updated', 'Organization', organizationId, { name: changed.name, slug: changed.slug });
  res.json({ id: changed.id, name: changed.name, slug: changed.slug, status: changed.status, updatedAt: changed.updatedAt });
} catch (error) { next(error); } });
app.get('/api/organizations/:organizationId/members', authenticate, authorize(...organizationApiRoles.memberManage), async (req: AuthRequest, res, next) => { try {
  const members = await prisma.membership.findMany({
    where: { organizationId: req.auth!.organizationId! },
    orderBy: [{ user: { name: 'asc' } }, { userId: 'asc' }],
    select: { userId: true, role: true, active: true, createdAt: true, updatedAt: true, user: { select: { name: true, email: true } } }
  });
  res.json(members.map(({ userId, user, ...membership }) => ({ id: userId, ...user, ...membership })));
} catch (error) { next(error); } });
app.get('/api/organizations/:organizationId/members/:userId', authenticate, authorize(...organizationApiRoles.memberManage), async (req: AuthRequest, res, next) => { try {
  const member = await prisma.membership.findFirst({
    where: { organizationId: req.auth!.organizationId!, userId: String(req.params.userId) },
    select: { userId: true, role: true, active: true, createdAt: true, updatedAt: true, user: { select: { name: true, email: true } } }
  });
  if (!member) return res.status(404).json({ error: 'Organization member not found' });
  const { userId, user, ...membership } = member;
  res.json({ id: userId, ...user, ...membership });
} catch (error) { next(error); } });
app.patch('/api/organizations/:organizationId/members/:userId', authenticate, authorize(...organizationApiRoles.memberManage), async (req: AuthRequest, res, next) => { try {
  const data = memberUpdateSchema.parse(req.body);
  const organizationId = req.auth!.organizationId!;
  const userId = String(req.params.userId);
  if (userId === req.auth!.userId) return res.status(409).json({ error: 'Administrators cannot change their own membership through this endpoint' });
  const result = await prisma.$transaction(async tx => {
    const existing = await tx.membership.findFirst({ where: { organizationId, userId }, include: { user: { select: { isPlatformAdmin: true } } } });
    if (!existing) return { kind: 'not_found' as const };
    if (!memberCanBeManaged(req.auth!.userId, userId, existing.role, existing.user.isPlatformAdmin)) return { kind: 'forbidden' as const };
    const activeAdminCount = await tx.membership.count({ where: { organizationId, role: 'institute_admin', active: true } });
    if (wouldRemoveLastActiveAdmin(existing.role, existing.active, data.role, data.active, activeAdminCount)) return { kind: 'last_admin' as const };
    const membership = await tx.membership.update({ where: { userId_organizationId: { userId, organizationId } }, data });
    await tx.auditLog.create({ data: { organizationId, actorId: req.auth!.userId, action: 'organization.member_updated', targetType: 'Membership', targetId: userId, metadata: { role: membership.role, active: membership.active } } });
    return { kind: 'ok' as const, membership };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (result.kind === 'not_found') return res.status(404).json({ error: 'Organization member not found' });
  if (result.kind === 'forbidden') return res.status(403).json({ error: 'This membership cannot be changed by the current administrator' });
  if (result.kind === 'last_admin') return res.status(409).json({ error: 'The organization must retain at least one active institute administrator' });
  const changed = result.membership;
  res.json({ id: changed.userId, role: changed.role, active: changed.active, createdAt: changed.createdAt, updatedAt: changed.updatedAt });
} catch (error) { next(error); } });
app.delete('/api/organizations/:organizationId/members/:userId', authenticate, authorize(...organizationApiRoles.memberManage), async (req: AuthRequest, res, next) => { try {
  const organizationId = req.auth!.organizationId!;
  const userId = String(req.params.userId);
  if (userId === req.auth!.userId) return res.status(409).json({ error: 'Administrators cannot remove their own membership through this endpoint' });
  const result = await prisma.$transaction(async tx => {
    const existing = await tx.membership.findFirst({ where: { organizationId, userId }, include: { user: { select: { isPlatformAdmin: true } } } });
    if (!existing) return { kind: 'not_found' as const };
    if (!memberCanBeManaged(req.auth!.userId, userId, existing.role, existing.user.isPlatformAdmin)) return { kind: 'forbidden' as const };
    const activeAdminCount = await tx.membership.count({ where: { organizationId, role: 'institute_admin', active: true } });
    if (existing.role === 'institute_admin' && (activeAdminCount === 0 || (existing.active && activeAdminCount <= 1))) return { kind: 'last_admin' as const };
    await tx.membership.delete({ where: { userId_organizationId: { userId, organizationId } } });
    await tx.auditLog.create({ data: { organizationId, actorId: req.auth!.userId, action: 'organization.member_removed', targetType: 'Membership', targetId: userId, metadata: { previousRole: existing.role } } });
    return { kind: 'ok' as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (result.kind === 'not_found') return res.status(404).json({ error: 'Organization member not found' });
  if (result.kind === 'forbidden') return res.status(403).json({ error: 'This membership cannot be removed by the current administrator' });
  if (result.kind === 'last_admin') return res.status(409).json({ error: 'The organization must retain at least one active institute administrator' });
  res.status(204).end();
} catch (error) { next(error); } });
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
app.get('/api/organizations/:organizationId/candidates', authenticate, authorize(...organizationApiRoles.candidateRead), async (req: AuthRequest, res, next) => { try {
  const filters = candidateListQuerySchema.parse(req.query);
  const organizationId = req.auth!.organizationId!;
  const where = candidateWhere(organizationId, filters.search);
  const orderBy = [{ [filters.sortBy]: filters.sortOrder }, { id: 'asc' }] as Prisma.CandidateOrderByWithRelationInput[];
  const [total, candidates] = await Promise.all([
    prisma.candidate.count({ where }),
    prisma.candidate.findMany({ where, orderBy, skip: paginationOffset(filters.page, filters.pageSize), take: filters.pageSize })
  ]);
  res.set(paginationHeaders(filters.page, filters.pageSize, total));
  res.json(candidates);
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
app.put('/api/organizations/:organizationId/exams/:examId/questions/order', authenticate, authorize(...organizationApiRoles.questionManage), async (req: AuthRequest, res, next) => { try {
  const data = questionOrderSchema.parse(req.body);
  const organizationId = req.auth!.organizationId!;
  const examId = String(req.params.examId);
  const result = await prisma.$transaction(async tx => {
    // Lock the parent exam row before validating draft state. The publish route
    // updates this same row, so it must wait for reordering to finish (or win
    // first, in which case this query finds no editable draft). Serializable
    // isolation alone does not force a separate autocommit publish request to
    // participate in the reorder transaction's snapshot.
    const lockedExams = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "exams"
      WHERE "id" = ${examId}::uuid
        AND "organizationId" = ${organizationId}::uuid
        AND "status" = 'draft'
      FOR UPDATE
    `;
    if (lockedExams.length === 0) return { kind: 'exam_not_found' as const };
    const existing = await tx.question.findMany({ where: { organizationId, examId }, select: { id: true } });
    if (!questionOrderMatches(existing.map(question => question.id), data.questionIds)) return { kind: 'question_set_mismatch' as const };
    const attemptCount = await tx.examAttempt.count({ where: { organizationId, examId } });
    if (attemptCount > 0) return { kind: 'exam_has_attempts' as const };
    for (const [position, questionId] of data.questionIds.entries()) {
      await tx.question.updateMany({ where: { id: questionId, organizationId, examId }, data: { position } });
    }
    await tx.auditLog.create({ data: { organizationId, actorId: req.auth!.userId, action: 'exam.questions_reordered', targetType: 'Exam', targetId: examId, metadata: { questionIds: data.questionIds } } });
    const questions = await tx.question.findMany({ where: { organizationId, examId }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
    return { kind: 'ok' as const, questions };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (result.kind === 'exam_not_found') return res.status(404).json({ error: 'Editable draft exam not found' });
  if (result.kind === 'question_set_mismatch') return res.status(400).json({ error: 'questionIds must contain every question in this exam exactly once' });
  if (result.kind === 'exam_has_attempts') return res.status(409).json({ error: 'Question order is locked because this examination already has attempts' });
  res.json({ examId, questions: result.questions });
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
app.post('/api/organizations/:organizationId/candidates/:candidateId/documents/:kind', authenticate, upload.single('file'), validateFileContent, async (req: AuthRequest, res, next) => { try {
  const organizationId = String(req.params.organizationId);
  const kind = String(req.params.kind);
  const candidate = await prisma.candidate.findFirst({ where: { id: String(req.params.candidateId), organizationId, userId: req.auth!.userId } });
  if (!candidate || !req.file || !['photo', 'idDocument'].includes(kind)) return res.status(403).json({ error: 'Authorized file required' });
  if (kind === 'photo' && !['image/jpeg', 'image/png', 'image/webp'].includes(req.file.mimetype)) return res.status(400).json({ error: 'A profile photo must be a JPEG, PNG, or WebP image' });
  const key = `organizations/${organizationId}/candidates/${candidate.id}/${kind}-${Date.now()}`;
  const storage = req.app.get('storage');
  await storage.putPrivateDocument(key, req.file.buffer, req.file.mimetype);
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
  const startInput = z.object({ accessCode: z.string().optional(), monitoringConsentAccepted: z.literal(true), monitoringConsentVersion: z.literal('examguard-monitoring-v1') }).parse(req.body ?? {});
  const accessCode = startInput.accessCode;
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
      attempt = await prisma.examAttempt.create({ data: { organizationId, examId: exam.id, candidateId: candidate.id, userId: req.auth!.userId, startedAt, deadlineAt: deadlineFor(startedAt, exam.durationMinutes, exam.endsAt ?? undefined), monitoringConsentAt: startedAt, monitoringConsentVersion: startInput.monitoringConsentVersion, questionOrder: order } });
      await audit(organizationId, req.auth!.userId, 'attempt.started', 'ExamAttempt', attempt.id, { monitoringConsentVersion: startInput.monitoringConsentVersion });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      attempt = await prisma.examAttempt.findUniqueOrThrow({ where: { examId_candidateId: { examId: exam.id, candidateId: candidate.id } } });
    }
  }
  if (!isAttemptOpen(attempt.status, attempt.deadlineAt)) return res.status(409).json({ error: 'Attempt is no longer open' });
  if (!attempt.monitoringConsentAt || attempt.monitoringConsentVersion !== startInput.monitoringConsentVersion) {
    attempt = await prisma.examAttempt.update({ where: { id: attempt.id }, data: { monitoringConsentAt: new Date(), monitoringConsentVersion: startInput.monitoringConsentVersion } });
    await audit(organizationId, req.auth!.userId, 'attempt.monitoring_consent_recorded', 'ExamAttempt', attempt.id, { monitoringConsentVersion: startInput.monitoringConsentVersion });
  }
  const companionHeartbeat = await prisma.radioObservation.findFirst({ where: { organizationId, attemptId: attempt.id, source: 'scanner_health', kind: 'heartbeat', scannerStatus: 'active', observedAt: { gt: new Date(Date.now() - 90_000) } }, select: { id: true } });
  const companionReady = Boolean(companionHeartbeat);
  // Do not release exam questions until the required Windows Companion has
  // authenticated this attempt and sent its first active heartbeat.
  const rows = companionReady ? await prisma.question.findMany({ where: { id: { in: attempt.questionOrder }, organizationId } }) : [];
  const byId = new Map(rows.map(q => [q.id, q]));
  const questions = companionReady ? attempt.questionOrder.flatMap(id => { const q = byId.get(id); if (!q) return []; const options = Array.isArray(q.options) ? q.options : []; return [{ id: q.id, type: q.type, prompt: q.prompt, options: exam.randomizeOptions ? shuffle(options) : options, marks: q.marks }]; }) : [];
  const answers = companionReady ? await prisma.attemptAnswer.findMany({ where: { attemptId: attempt.id } }) : [];
  res.json({ attempt: { id: attempt.id, candidateId: candidate.id, examId: exam.id, deadlineAt: attempt.deadlineAt, status: attempt.status }, exam: { title: exam.title, instructions: exam.instructions }, questions, answers, companionRequired: !companionReady });
} catch (error) { next(error); } });
app.put('/api/student/attempts/:attemptId/answers/:questionId', authenticate, async (req: AuthRequest, res, next) => { try {
  const attemptId = String(req.params.attemptId);
  const questionId = String(req.params.questionId);
  const result = await prisma.$transaction(async tx => {
    // Serialize answer writes against final submission and expiry transitions.
    // The same attempt-row lock is acquired by the submit route below.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "exam_attempts"
      WHERE "id" = ${attemptId}::uuid AND "userId" = ${req.auth!.userId}::uuid
      FOR UPDATE
    `;
    if (locked.length === 0) return { kind: 'not_found' as const };
    const attempt = await tx.examAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    if (!isAttemptOpen(attempt.status, attempt.deadlineAt)) return { kind: 'closed' as const };
    const question = await tx.question.findFirst({ where: { id: questionId, examId: attempt.examId, organizationId: attempt.organizationId }, select: { id: true, type: true, options: true } });
    if (!question) return { kind: 'question_not_found' as const };
    const value = validateAnswerValue(question, req.body?.value);
    const savedAt = new Date();
    const answer = await tx.attemptAnswer.upsert({
      where: { attemptId_questionId: { attemptId: attempt.id, questionId: question.id } },
      update: { value, savedAt },
      create: { attemptId: attempt.id, questionId: question.id, organizationId: attempt.organizationId, value, savedAt }
    });
    return { kind: 'saved' as const, savedAt: answer.savedAt };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  if (result.kind === 'not_found') return res.status(404).json({ error: 'Attempt not found' });
  if (result.kind === 'closed') return res.status(409).json({ error: 'Attempt is closed' });
  if (result.kind === 'question_not_found') return res.status(404).json({ error: 'Question not found' });
  res.json({ savedAt: result.savedAt });
} catch (error) { next(error); } });
app.post('/api/student/attempts/:attemptId/submit', authenticate, async (req: AuthRequest, res, next) => { try {
  const attemptId = String(req.params.attemptId);
  const result = await prisma.$transaction(async tx => {
    // Locking the attempt makes concurrent submits and answer autosaves agree
    // on one ordering; the terminal state and audit record commit together.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "exam_attempts"
      WHERE "id" = ${attemptId}::uuid AND "userId" = ${req.auth!.userId}::uuid
      FOR UPDATE
    `;
    if (locked.length === 0) return { kind: 'not_found' as const };
    const attempt = await tx.examAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    if (attempt.status === 'submitted' || attempt.status === 'expired') return { kind: 'already_closed' as const, receiptCode: attempt.receiptCode };
    if (attempt.status === 'paused' || attempt.status === 'terminated') return { kind: 'blocked' as const, status: attempt.status };
    if (attempt.status !== 'in_progress') return { kind: 'blocked' as const, status: attempt.status };
    const submittedAt = new Date();
    const status = submissionStatusAt(attempt.deadlineAt, submittedAt);
    const receiptCode = `EG-${attempt.id.slice(-6).toUpperCase()}-${submittedAt.getTime().toString(36).toUpperCase()}`;
    await tx.examAttempt.update({ where: { id: attempt.id }, data: { status, submittedAt, receiptCode } });
    await tx.auditLog.create({ data: { organizationId: attempt.organizationId, actorId: req.auth!.userId, action: 'attempt.submitted', targetType: 'ExamAttempt', targetId: attempt.id, metadata: { status, receiptCode } } });
    return { kind: 'submitted' as const, status, receiptCode, submittedAt };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  if (result.kind === 'not_found') return res.status(404).json({ error: 'Attempt not found' });
  if (result.kind === 'already_closed') return res.status(409).json({ error: 'Already submitted', receiptCode: result.receiptCode });
  if (result.kind === 'blocked') return res.status(409).json({ error: `Attempt is ${result.status} and cannot be submitted by the candidate` });
  res.json({ status: result.status, receiptCode: result.receiptCode, submittedAt: result.submittedAt });
} catch (error) { next(error); } });
app.get('/api/organizations/:organizationId/proctoring/config', authenticate, authorize('institute_admin', 'teacher', 'proctor'), async (req: AuthRequest, res, next) => { try {
  res.json(await orgConfig(req.auth!.organizationId!));
} catch (error) { next(error); } });
app.post('/api/student/attempts/:attemptId/evidence', authenticate, upload.single('file'), validateFileContent, async (req: AuthRequest, res, next) => { try {
  const storage = req.app.get('storage');
  if (!storage.storageConfigured()) return res.status(503).json({ error: 'Private evidence storage is not configured' });
  const attempt = await prisma.examAttempt.findFirst({ where: { id: String(req.params.attemptId), userId: req.auth!.userId, status: 'in_progress', deadlineAt: { gt: new Date() } } });
  if (!attempt || !req.file || !['image/jpeg', 'image/png', 'image/webp'].includes(req.file.mimetype)) return res.status(403).json({ error: 'An active attempt and a JPEG, PNG, or WebP image are required' });
  // Capacity protection: refuse new evidence when the organization's quota is full. Existing evidence is never deleted to make room.
  const used = (await prisma.evidenceObject.aggregate({ where: { organizationId: attempt.organizationId }, _sum: { sizeBytes: true } }))._sum.sizeBytes ?? 0;
  const quota = evaluateQuota({ usedBytes: used, incomingBytes: req.file.size, quotaBytes: parseQuotaBytes(process.env.EVIDENCE_ORG_QUOTA_MB) });
  if (!quota.allowed) { await audit(attempt.organizationId, req.auth!.userId, 'evidence.quota_rejected', 'ExamAttempt', attempt.id, { usedBytes: used }); return res.status(507).json({ error: 'Evidence storage is full for this organization. Your exam continues; please tell your organizer.' }); }
  const key = `organizations/${attempt.organizationId}/attempts/${attempt.id}/evidence/${crypto.randomUUID()}`;
  await storage.putPrivateDocument(key, req.file.buffer, req.file.mimetype);
  // Best effort: a failed bookkeeping write must not discard evidence that is already stored.
  await prisma.evidenceObject.create({ data: { organizationId: attempt.organizationId, attemptId: attempt.id, objectKey: key, sizeBytes: req.file.size, mimeType: req.file.mimetype } }).catch(error => console.error('Evidence size bookkeeping failed', error instanceof Error ? error.message : error));
  res.status(201).json({ evidenceKey: key });
} catch (error) { next(error); } });
app.post('/api/student/attempts/:attemptId/ai-frame', authenticate, aiFrameLimiter, upload.single('frame'), validateFileContent, async (req: AuthRequest, res, next) => { try {
  const attemptId = String(req.params.attemptId);
  const attempt = await prisma.examAttempt.findFirst({ where: { id: attemptId, userId: req.auth!.userId, status: 'in_progress', deadlineAt: { gt: new Date() } } });
  if (!attempt) return res.status(409).json({ error: 'An active authorized attempt is required' });
  if (!attempt.monitoringConsentAt || attempt.monitoringConsentVersion !== 'examguard-monitoring-v1') return res.status(403).json({ error: 'Monitoring consent is not recorded for this attempt' });
  if (!req.file || !['image/jpeg', 'image/png', 'image/webp'].includes(req.file.mimetype)) return res.status(415).json({ error: 'A JPEG, PNG, or WebP camera frame is required' });
  const companionHeartbeat = await prisma.radioObservation.findFirst({ where: { organizationId: attempt.organizationId, attemptId, source: 'scanner_health', kind: 'heartbeat', scannerStatus: 'active', observedAt: { gt: new Date(Date.now() - 90_000) } }, select: { id: true } });
  if (!companionHeartbeat) return res.status(409).json({ error: 'The required Windows Companion is not reporting. Reconnect it to continue monitoring.' });
  const serviceUrl = process.env.AI_SERVICE_URL;
  const serviceToken = process.env.AI_SERVICE_TOKEN;
  if (!serviceUrl || !serviceToken || serviceToken.length < 32) return res.status(503).json({ error: 'The local AI service is not securely configured. Set AI_SERVICE_URL and a 32-character AI_SERVICE_TOKEN.' });
  let analyzeUrl: URL;
  try {
    const base = new URL(serviceUrl);
    const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
    if (!['http:', 'https:'].includes(base.protocol) || (process.env.NODE_ENV !== 'production' && !localHosts.has(base.hostname))) return res.status(503).json({ error: 'AI_SERVICE_URL must use the approved local service host in local mode.' });
    analyzeUrl = new URL('/analyze', base);
  } catch { return res.status(503).json({ error: 'AI_SERVICE_URL is invalid.' }); }
  const form = new FormData();
  form.append('frame', new Blob([new Uint8Array(req.file.buffer)], { type: req.file.mimetype }), 'camera-frame');
  let inferenceResponse: Response;
  try {
    inferenceResponse = await fetch(analyzeUrl, { method: 'POST', headers: { Authorization: `Bearer ${serviceToken}` }, body: form, signal: AbortSignal.timeout(12_000) });
  } catch {
    return res.status(503).json({ error: 'The local AI service did not respond. Check that it is running on the configured address.' });
  }
  if (!inferenceResponse.ok) return res.status(503).json({ error: `The local AI service returned HTTP ${inferenceResponse.status}.` });
  let analysis: z.infer<typeof aiFrameSchema>;
  try { analysis = aiFrameSchema.parse(await inferenceResponse.json()); }
  catch { return res.status(502).json({ error: 'The AI service returned an invalid analysis response.' }); }
  const qualified = aiSignalsForFrame(attempt.id, {
    face_missing: !analysis.face_presence,
    multiple_faces: analysis.multiple_faces,
    looking_away: analysis.looking_away === 'looking_away',
    phone_detected: analysis.phone_detection === 'detected'
  });
  if (!qualified.length) return res.json({ analysis, recorded: [], temporalRule: '3_of_5_frames' });

  const config = await orgConfig(attempt.organizationId);
  const examRecord = await prisma.exam.findUniqueOrThrow({ where: { id: attempt.examId } });
  const policy = policyOf(examRecord);
  const freshSignals: Array<{ type: string; occurredAt: Date; fingerprint: string }> = [];
  const duplicates: Array<{ type: string; deduplicated: true }> = [];
  for (const type of qualified) {
    const occurredAt = new Date();
    const fingerprint = fingerprintFor(attempt.organizationId, attempt.candidateId, type, dedupeWindow(occurredAt, config.cooldownSeconds));
    if (await prisma.proctoringEvent.findFirst({ where: { organizationId: attempt.organizationId, fingerprint }, select: { id: true } })) duplicates.push({ type, deduplicated: true });
    else freshSignals.push({ type, occurredAt, fingerprint });
  }
  if (!freshSignals.length) return res.json({ analysis, recorded: duplicates, temporalRule: '3_of_5_frames' });

  const storage = req.app.get('storage') as StorageInterface;
  if (!storage.storageConfigured()) return res.status(503).json({ error: 'AI signals were observed repeatedly, but private evidence storage is not configured. Configure private object storage before using AI incident capture.' });
  const used = (await prisma.evidenceObject.aggregate({ where: { organizationId: attempt.organizationId }, _sum: { sizeBytes: true } }))._sum.sizeBytes ?? 0;
  const quota = evaluateQuota({ usedBytes: used, incomingBytes: req.file.size, quotaBytes: parseQuotaBytes(process.env.EVIDENCE_ORG_QUOTA_MB) });
  if (!quota.allowed) return res.status(507).json({ error: 'Private evidence storage is full for this organization; the AI signal was not turned into an incident.' });
  const evidenceKey = `organizations/${attempt.organizationId}/attempts/${attempt.id}/evidence/${crypto.randomUUID()}`;
  await storage.putPrivateDocument(evidenceKey, req.file.buffer, req.file.mimetype);
  await prisma.evidenceObject.create({ data: { organizationId: attempt.organizationId, attemptId: attempt.id, objectKey: evidenceKey, sizeBytes: req.file.size, mimeType: req.file.mimetype } });

  const recorded: Array<{ type: string; incidentId?: string; eventId?: string; deduplicated?: boolean }> = [...duplicates];
  for (const { type, occurredAt, fingerprint } of freshSignals) {
    const windowStart = new Date(occurredAt.getTime() - policy.windowSeconds * 1000);
    const eventCount = await prisma.proctoringEvent.count({ where: { organizationId: attempt.organizationId, attemptId: attempt.id, type, occurredAt: { gte: windowStart } } }) + 1;
    const event = await prisma.proctoringEvent.create({ data: {
      organizationId: attempt.organizationId, examId: attempt.examId, candidateId: attempt.candidateId,
      attemptId: attempt.id, type, occurredAt, source: 'ai_service', evidenceKey, fingerprint,
      warningCount: eventCount, policyAction: 'recorded',
      details: {
        faceCount: analysis.face_count,
        lookingAway: analysis.looking_away,
        headPose: analysis.head_pose ?? null,
        phoneConfidence: analysis.phone_confidence ?? null,
        modelVersion: analysis.service_version ?? 'unknown',
        temporalConfirmation: '3_of_5_frames',
        disclosure: 'AI signal for human review only; approximate head orientation is not eye-gaze tracking.'
      } as Prisma.InputJsonValue
    } });
    const weight = Number((config.signalWeights as Record<string, number>)[type] ?? 0);
    const priority = reviewPriority([{ type, weight }]);
    const incident = await prisma.incident.create({ data: {
      organizationId: attempt.organizationId, examId: attempt.examId, candidateId: attempt.candidateId,
      type, severity: priority.score >= 30 ? 'high' : priority.score >= 15 ? 'medium' : 'low',
      riskPriority: priority.score, contributingSignals: priority.contributingSignals.map(x => ({ ...x, eventId: event.id })),
      details: `Repeated AI camera signal queued for human review: ${type}`,
      events: { create: { eventId: event.id } }
    } });
    await audit(attempt.organizationId, req.auth!.userId, 'proctoring.ai_signal_recorded', 'Incident', incident.id, { eventId: event.id, temporalConfirmation: '3_of_5_frames' });
    const broadcast = req.app.get('broadcast') as undefined | ((room: string, payload: unknown) => void);
    broadcast?.(`org:${attempt.organizationId}:exam:${attempt.examId}`, { incidentId: incident.id, attemptId: attempt.id, type, action: 'recorded', warningCount: eventCount, occurredAt });
    recorded.push({ type, incidentId: incident.id, eventId: event.id });
  }
  res.status(recorded.some(item => item.incidentId) ? 201 : 202).json({ analysis, recorded, evidenceAttached: true, temporalRule: '3_of_5_frames' });
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
  // Browser face/phone detections are advisory signals. They may inform a reviewer,
  // but must never automatically pause or terminate an examination attempt.
  const action = 'recorded' as const;
  const event = await prisma.proctoringEvent.create({ data: { organizationId, examId: data.examId, candidateId: candidate.id, sessionId: data.sessionId, attemptId: attempt.id, type: data.type, occurredAt, source: data.source, evidenceKey: data.evidenceKey, fingerprint, warningCount: eventCount, policyAction: action, details: data.details as Prisma.InputJsonValue | undefined } });
  const weight = Number((config.signalWeights as Record<string, number>)[data.type] ?? 0);
  const priority = reviewPriority([{ type: data.type, weight }]);
  const incident = await prisma.incident.create({
    data: {
      organizationId, examId: data.examId, candidateId: candidate.id, sessionId: data.sessionId, type: data.type,
      severity: priority.score >= 30 ? 'high' : priority.score >= 15 ? 'medium' : 'low',
      riskPriority: priority.score,
      contributingSignals: priority.contributingSignals.map(x => ({ ...x, eventId: event.id })),
      details: `Automated signal queued for human review: ${data.type}`,
      events: { create: { eventId: event.id } }
    }
  });
  await audit(organizationId, req.auth!.userId, 'proctoring.event_recorded', 'Incident', incident.id, { eventId: event.id, action, eventCount });
  const broadcast = app.get('broadcast') as undefined | ((room: string, payload: unknown) => void);
  broadcast?.(`org:${organizationId}:exam:${data.examId}`, { incidentId: incident.id, attemptId: attempt.id, type: event.type, action, warningCount: eventCount, occurredAt: event.occurredAt });
  res.status(201).json({ incidentId: incident.id, eventId: event.id, action, warningCount: eventCount });
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
  if (!attempt.monitoringConsentAt || attempt.monitoringConsentVersion !== 'examguard-monitoring-v1') return res.status(403).json({ error: 'Explicit monitoring consent must be recorded before Companion connection.' });
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
  if (!attempt.monitoringConsentAt || attempt.monitoringConsentVersion !== 'examguard-monitoring-v1') return res.status(403).json({ error: 'Monitoring consent is not recorded for this attempt' });
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
  const result = await prisma.$transaction(async tx => {
    const current = await tx.radioCandidateSignal.findFirst({ where: { id: signalId, organizationId } });
    if (!current) return { kind: 'not_found' as const };
    if (current.status === data.status && current.reviewerNotes === data.notes && current.reviewerId === req.auth!.userId) return { kind: 'idempotent' as const, signal: current };
    if (!canTransitionRadio(current.status, data.status)) return { kind: 'conflict' as const, currentStatus: current.status };
    const updated = await tx.radioCandidateSignal.updateMany({ where: { id: signalId, organizationId, status: current.status }, data: { status: data.status, reviewerNotes: data.notes, reviewerId: req.auth!.userId } });
    if (updated.count !== 1) {
      const latest = await tx.radioCandidateSignal.findFirst({ where: { id: signalId, organizationId } });
      if (latest?.status === data.status && latest.reviewerNotes === data.notes && latest.reviewerId === req.auth!.userId) return { kind: 'idempotent' as const, signal: latest };
      return { kind: 'conflict' as const, currentStatus: latest?.status };
    }
    const saved = await tx.radioCandidateSignal.findUniqueOrThrow({ where: { id: signalId } });
    await tx.auditLog.create({ data: { organizationId, actorId: req.auth!.userId, action: 'radio.signal_reviewed', targetType: 'RadioCandidateSignal', targetId: saved.id, metadata: { ...data, fromStatus: current.status, toStatus: data.status } as Prisma.InputJsonValue } });
    return { kind: 'updated' as const, signal: saved };
  });
  if (result.kind === 'not_found') return res.status(404).json({ error: 'Radio candidate signal not found' });
  if (result.kind === 'conflict') return res.status(409).json({ error: 'Radio signal review state changed or has already been reviewed. Refresh before deciding again.', currentStatus: result.currentStatus });
  res.json({ ...result.signal, idempotent: result.kind === 'idempotent' });
} catch (error) { next(error); } });
app.get('/api/organizations/:organizationId/incidents', authenticate, authorize(...organizationApiRoles.incidentRead), async (req: AuthRequest, res, next) => { try {
  const filters = incidentListQuerySchema.parse(req.query);
  const organizationId = req.auth!.organizationId!;
  const where = incidentWhere(organizationId, filters);
  const [total, incidents] = await Promise.all([
    prisma.incident.count({ where }),
    prisma.incident.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: paginationOffset(filters.page, filters.pageSize),
      take: filters.pageSize,
      include: { events: { include: { event: true } }, candidate: { select: { id: true, name: true, email: true } }, exam: { select: { id: true, title: true } } }
    })
  ]);
  res.set(paginationHeaders(filters.page, filters.pageSize, total));
  res.json(await Promise.all(incidents.map(async ({ events, candidate, exam, ...incident }) => ({
    ...incident,
    candidateId: candidate ?? incident.candidateId,
    examId: exam ?? incident.examId,
    eventIds: await Promise.all(events.map(async ({ event }) => {
      const { evidenceKey, ...safeEvent } = event;
      if (!evidenceKey || !event.attemptId || !storage.storageConfigured() || !evidenceKeyMatchesAttempt(evidenceKey, organizationId, event.attemptId)) return { ...safeEvent, evidenceUrl: undefined };
      const attempt = await prisma.examAttempt.findFirst({ where: { id: event.attemptId, organizationId, examId: event.examId, candidateId: event.candidateId }, select: { id: true } });
      if (!attempt) return { ...safeEvent, evidenceUrl: undefined };
      let contentType: string | undefined;
      if (storage.privateDocumentMetadata) {
        const metadata = await storage.privateDocumentMetadata(evidenceKey);
        if (privateEvidenceMetadataError(metadata)) return { ...safeEvent, evidenceUrl: undefined };
        contentType = metadata?.contentType;
      }
      const evidenceUrl = await storage.privateDocumentUrl(evidenceKey, contentType, evidenceUrlTtlSeconds);
      await audit(organizationId, req.auth!.userId, 'evidence.private_url_issued', 'ProctoringEvent', event.id, { expiresIn: evidenceUrlTtlSeconds, source: 'incident_review' });
      return { ...safeEvent, evidenceUrl };
    }))
  }))));
} catch (error) { next(error); } });
app.get('/api/organizations/:organizationId/evidence', authenticate, authorize(...evidenceReviewerRoles), async (req: AuthRequest, res, next) => { try {
  const filters = evidenceInventoryQuerySchema.parse(req.query);
  const organizationId = req.auth!.organizationId!;
  const dateRange = filters.from || filters.to ? { ...(filters.from ? { gte: new Date(filters.from) } : {}), ...(filters.to ? { lte: new Date(filters.to) } : {}) } : undefined;
  const relationSearch: any = filters.search ? { OR: [
    { candidate: { name: { contains: filters.search, mode: 'insensitive' as const } } },
    { candidate: { email: { contains: filters.search, mode: 'insensitive' as const } } },
    { exam: { title: { contains: filters.search, mode: 'insensitive' as const } } },
  ] } : {};
  const radioSearchOr: any[] | undefined = filters.search ? [
    ...relationSearch.OR,
    { pseudonym: { contains: filters.search, mode: 'insensitive' as const } },
    { errorCode: { contains: filters.search, mode: 'insensitive' as const } },
    ...(['bluetooth_le', 'wifi', 'scanner_health'].includes(filters.search) ? [{ source: filters.search }] : []),
    ...(['advertisement', 'access_point', 'scan_unavailable', 'permission_denied', 'scan_error', 'scan_stopped'].includes(filters.search) ? [{ kind: filters.search }] : []),
  ] : undefined;
  const eventWhere: any = {
    organizationId,
    candidate: { is: { organizationId } },
    exam: { is: { organizationId } },
    attempt: { is: { organizationId } },
    attemptId: { not: null },
    ...(filters.candidateId ? { candidateId: filters.candidateId } : {}),
    ...(filters.examId ? { examId: filters.examId } : {}),
    ...(filters.attemptId ? { attemptId: filters.attemptId } : {}),
    ...(dateRange ? { occurredAt: dateRange } : {}),
    ...(filters.search ? { OR: [...relationSearch.OR, { type: { contains: filters.search, mode: 'insensitive' } }] } : {}),
    ...(filters.type === 'image' ? { evidenceKey: { not: null } } : {}),
    ...(filters.type === 'browser_event' ? { source: 'browser', evidenceKey: null } : {}),
    ...(filters.type === 'ai_signal' ? { source: 'ai_service' } : {}),
    ...(filters.reviewStatus === 'pending_review' ? { incidents: { some: { incident: { status: { in: ['open', 'awaiting_student'] } } } } } : {}),
    ...(filters.reviewStatus === 'reviewed' ? { AND: [{ incidents: { some: { incident: { status: { in: ['dismissed', 'resolved'] } } } } }, { incidents: { none: { incident: { status: { in: ['open', 'awaiting_student', 'escalated'] } } } } }] } : {}),
    ...(filters.reviewStatus === 'escalated' ? { incidents: { some: { incident: { status: 'escalated' } } } } : {}),
  };
  const radioWhere: any = {
    organizationId,
    expiresAt: { gt: new Date() },
    candidate: { is: { organizationId } },
    exam: { is: { organizationId } },
    attempt: { is: { organizationId } },
    ...(filters.candidateId ? { candidateId: filters.candidateId } : {}),
    ...(filters.examId ? { examId: filters.examId } : {}),
    ...(filters.attemptId ? { attemptId: filters.attemptId } : {}),
    ...(dateRange ? { observedAt: dateRange } : {}),
    ...(radioSearchOr ? { OR: radioSearchOr } : {}),
    ...(filters.reviewStatus === 'pending_review' ? { AND: [{ OR: [{ signals: { none: {} } }, { signals: { some: { signal: { status: 'pending_review' } } } }] }] } : {}),
    ...(filters.reviewStatus === 'reviewed' ? { AND: [{ signals: { some: { signal: { status: { in: ['reviewed_no_concern', 'reviewed_concern_retained', 'insufficient_evidence'] } } } } }, { signals: { none: { signal: { status: 'pending_review' } } } }] } : {}),
    ...(filters.reviewStatus === 'escalated' ? { id: { in: [] } } : {}),
  };
  const codeWhere: any = {
    organizationId,
    candidate: { is: { organizationId } },
    attempt: { is: { organizationId, ...(filters.examId ? { examId: filters.examId } : {}) } },
    ...(filters.candidateId ? { candidateId: filters.candidateId } : {}),
    ...(filters.attemptId ? { attemptId: filters.attemptId } : {}),
    ...(dateRange ? { submittedAt: dateRange } : {}),
    ...(filters.search ? { OR: [
      { candidate: { name: { contains: filters.search, mode: 'insensitive' as const } } },
      { candidate: { email: { contains: filters.search, mode: 'insensitive' as const } } },
      { languageId: { contains: filters.search, mode: 'insensitive' as const } },
      { codingQuestion: { title: { contains: filters.search, mode: 'insensitive' as const } } },
      { attempt: { exam: { title: { contains: filters.search, mode: 'insensitive' as const } } } },
    ] } : {}),
  };
  const includeEvents = !filters.type || ['image', 'browser_event', 'ai_signal'].includes(filters.type);
  const includeRadio = !filters.type || filters.type === 'radio_observation';
  const includeCode = !filters.type || filters.type === 'coding_submission';
  const offset = evidenceOffset(filters.page, filters.pageSize);
  const [eventCount, radioCount, codeCount, events, radios, codeSubmissions] = await Promise.all([
    includeEvents ? prisma.proctoringEvent.count({ where: eventWhere }) : 0,
    includeRadio ? prisma.radioObservation.count({ where: radioWhere }) : 0,
    includeCode && !filters.reviewStatus ? prisma.codeSubmission.count({ where: codeWhere }) : 0,
    includeEvents ? prisma.proctoringEvent.findMany({ where: eventWhere, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: offset + filters.pageSize, include: { candidate: { select: { id: true, name: true, email: true } }, exam: { select: { id: true, title: true } }, attempt: { select: { id: true, status: true } }, incidents: { include: { incident: { select: { id: true, status: true, decisionReason: true, reviewerNotes: true, createdAt: true, updatedAt: true } } } } } }) : [],
    includeRadio ? prisma.radioObservation.findMany({ where: radioWhere, orderBy: [{ observedAt: 'desc' }, { id: 'desc' }], take: offset + filters.pageSize, include: { candidate: { select: { id: true, name: true, email: true } }, exam: { select: { id: true, title: true } }, attempt: { select: { id: true, status: true } }, signals: { include: { signal: { select: { id: true, status: true, reviewerNotes: true, reviewerId: true, createdAt: true, updatedAt: true } } } } } }) : [],
    includeCode && !filters.reviewStatus ? prisma.codeSubmission.findMany({ where: codeWhere, orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }], take: offset + filters.pageSize, include: { candidate: { select: { id: true, name: true, email: true } }, attempt: { select: { id: true, status: true, exam: { select: { id: true, title: true } } } }, codingQuestion: { select: { id: true, title: true } } } }) : [],
  ]);
  const items: Array<Record<string, any>> = [];
  for (const event of events as any[]) {
    const reviewStatus = incidentReviewStatus(event.incidents.map((link: any) => link.incident.status));
    items.push({ id: event.id, kind: event.evidenceKey ? 'image' : event.source === 'ai_service' ? 'ai_signal' : 'browser_event', type: event.type, source: event.source, occurredAt: event.occurredAt, organizationId, candidate: event.candidate, exam: event.exam, attempt: event.attempt, hasBinary: Boolean(event.evidenceKey), reviewStatus, incidents: event.incidents.map((link: any) => ({ id: link.incident.id, status: link.incident.status, decisionReason: link.incident.decisionReason, reviewerNotes: link.incident.reviewerNotes })) });
  }
  for (const observation of radios as any[]) {
    const statuses = observation.signals.map((link: any) => link.signal.status);
    items.push({ id: observation.id, kind: 'radio_observation', type: `${observation.source}:${observation.kind}`, source: observation.source, occurredAt: observation.observedAt, organizationId, candidate: observation.candidate, exam: observation.exam, attempt: observation.attempt, hasBinary: false, reviewStatus: radioReviewStatus(statuses), details: { kind: observation.kind, rssi: observation.rssi, pseudonym: observation.pseudonym, scannerStatus: observation.scannerStatus, errorCode: observation.errorCode, limitations: observation.limitations }, signals: observation.signals.map((link: any) => ({ id: link.signal.id, status: link.signal.status, reviewerNotes: link.signal.reviewerNotes })) });
  }
  for (const submission of codeSubmissions as any[]) {
    items.push({ id: submission.id, kind: 'coding_submission', type: `${submission.kind}:${submission.status}`, source: 'coding', occurredAt: submission.submittedAt, organizationId, candidate: submission.candidate, exam: submission.attempt.exam, attempt: { id: submission.attempt.id, status: submission.attempt.status }, hasBinary: false, reviewStatus: 'not_available', details: { languageId: submission.languageId, question: submission.codingQuestion.title, executionStatus: submission.status } });
  }
  items.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime() || String(b.id).localeCompare(String(a.id)));
  const total = eventCount + radioCount + codeCount;
  res.set(evidencePaginationHeaders(filters.page, filters.pageSize, total));
  res.json(items.slice(offset, offset + filters.pageSize));
} catch (error) { next(error); } });

app.get('/api/organizations/:organizationId/evidence/:kind/:evidenceId/details', authenticate, authorize(...evidenceReviewerRoles), async (req: AuthRequest, res, next) => { try {
  const organizationId = req.auth!.organizationId!;
  const kind = z.enum(['image', 'browser_event', 'ai_signal', 'radio_observation', 'coding_submission']).parse(req.params.kind);
  const evidenceId = String(req.params.evidenceId);
  if (['image', 'browser_event', 'ai_signal'].includes(kind)) {
    const event = await prisma.proctoringEvent.findFirst({
      where: { id: evidenceId, organizationId },
      include: {
        candidate: { select: { id: true, name: true, email: true, organizationId: true } },
        exam: { select: { id: true, title: true, organizationId: true } },
        attempt: { select: { id: true, status: true, organizationId: true, examId: true, candidateId: true } },
        incidents: {
          include: {
            incident: {
              select: {
                id: true, status: true, decisionReason: true, reviewerNotes: true, createdAt: true, updatedAt: true,
                explanations: {
                  select: {
                    id: true, question: true, body: true, status: true, deadlineAt: true, respondedAt: true,
                    decision: true, decisionReason: true, decisionAt: true,
                    requestedBy: { select: { name: true } },
                    decidedBy: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!event || !event.attempt || !evidenceAttemptScopeMatches(event.attempt, event, organizationId) || event.exam.organizationId !== organizationId || event.candidate.organizationId !== organizationId) return res.status(404).json({ error: 'Evidence not found' });
    const actualKind = event.evidenceKey ? 'image' : event.source === 'ai_service' ? 'ai_signal' : 'browser_event';
    if (kind !== actualKind) return res.status(404).json({ error: 'Evidence not found' });
    await audit(organizationId, req.auth!.userId, 'evidence.detail_viewed', 'ProctoringEvent', event.id, { kind });
    const incidentIds = event.incidents.map(link => link.incident.id);
    const reviewHistory = incidentIds.length ? await prisma.auditLog.findMany({ where: { organizationId, targetType: 'Incident', targetId: { in: incidentIds }, action: { startsWith: 'incident.' } }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, action: true, metadata: true, createdAt: true, actor: { select: { name: true } } } }) : [];
    return res.json({ item: { id: event.id, kind: event.evidenceKey ? 'image' : kind, type: event.type, source: event.source, occurredAt: event.occurredAt, candidate: event.candidate, exam: event.exam, attempt: event.attempt, details: sanitizeEvidenceDetails(event.details), incidents: event.incidents.map(link => link.incident) }, reviewHistory });
  }
  if (kind === 'radio_observation') {
    const observation = await prisma.radioObservation.findFirst({ where: { id: evidenceId, organizationId }, include: { candidate: { select: { id: true, name: true, email: true, organizationId: true } }, exam: { select: { id: true, title: true, organizationId: true } }, attempt: { select: { id: true, status: true, organizationId: true, examId: true, candidateId: true } }, signals: { include: { signal: { select: { id: true, status: true, reviewerNotes: true, reviewerId: true, createdAt: true, updatedAt: true } } } } } });
    if (!observation || !evidenceAttemptScopeMatches(observation.attempt, observation, organizationId) || observation.exam.organizationId !== organizationId || observation.candidate.organizationId !== organizationId) return res.status(404).json({ error: 'Evidence not found' });
    await audit(organizationId, req.auth!.userId, 'evidence.detail_viewed', 'RadioObservation', observation.id);
    const signalIds = observation.signals.map(link => link.signal.id);
    const reviewHistory = signalIds.length ? await prisma.auditLog.findMany({ where: { organizationId, targetType: 'RadioCandidateSignal', targetId: { in: signalIds } }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, action: true, metadata: true, createdAt: true, actor: { select: { name: true } } } }) : [];
    return res.json({ item: { id: observation.id, kind, type: `${observation.source}:${observation.kind}`, occurredAt: observation.observedAt, candidate: observation.candidate, exam: observation.exam, attempt: observation.attempt, details: { kind: observation.kind, rssi: observation.rssi, pseudonym: observation.pseudonym, scannerStatus: observation.scannerStatus, errorCode: observation.errorCode, limitations: observation.limitations }, signals: observation.signals.map(link => link.signal) }, reviewHistory });
  }
  const submission = await prisma.codeSubmission.findFirst({ where: { id: evidenceId, organizationId }, include: { candidate: { select: { id: true, name: true, email: true, organizationId: true } }, attempt: { select: { id: true, status: true, organizationId: true, examId: true, candidateId: true, exam: { select: { id: true, title: true, organizationId: true } } } }, codingQuestion: { select: { id: true, title: true } } } });
  if (!submission || !evidenceAttemptScopeMatches(submission.attempt, { organizationId: submission.organizationId, examId: submission.attempt.examId, candidateId: submission.candidateId }, organizationId) || submission.attempt.exam.organizationId !== organizationId || submission.candidate.organizationId !== organizationId) return res.status(404).json({ error: 'Evidence not found' });
  await audit(organizationId, req.auth!.userId, 'evidence.detail_viewed', 'CodeSubmission', submission.id);
  return res.json({ item: { id: submission.id, kind, type: `${submission.kind}:${submission.status}`, occurredAt: submission.submittedAt, candidate: submission.candidate, exam: submission.attempt.exam, attempt: submission.attempt, details: { languageId: submission.languageId, question: submission.codingQuestion.title, executionStatus: submission.status, sourceCode: submission.sourceCode } }, reviewHistory: [] });
} catch (error) { next(error); } });

app.get('/api/organizations/:organizationId/evidence/:evidenceId/access', authenticate, authorize(...evidenceReviewerRoles), async (req: AuthRequest, res, next) => { try {
  const organizationId = req.auth!.organizationId!;
  const storage = req.app.get('storage') as StorageInterface;
  if (!storage.storageConfigured() || !storage.privateDocumentMetadata) return res.status(503).json({ error: 'Private evidence storage metadata is unavailable' });
  const event = await prisma.proctoringEvent.findFirst({ where: { id: String(req.params.evidenceId), organizationId, evidenceKey: { not: null } }, include: { attempt: { select: { id: true, organizationId: true, examId: true, candidateId: true } }, exam: { select: { id: true, organizationId: true } }, candidate: { select: { id: true, organizationId: true } } } });
  if (!event || !event.attempt || !evidenceAttemptScopeMatches(event.attempt, event, organizationId) || event.exam.organizationId !== organizationId || event.candidate.organizationId !== organizationId) return res.status(404).json({ error: 'Evidence not found' });
  if (!event.evidenceKey || !evidenceKeyMatchesAttempt(event.evidenceKey, organizationId, event.attempt.id)) return res.status(404).json({ error: 'Evidence not found' });
  let metadata: { contentType?: string; contentLength?: number } | null;
  let url: string;
  let expiresAt: number;
  try {
    metadata = await storage.privateDocumentMetadata(event.evidenceKey);
    if (!metadata) return res.status(404).json({ error: 'Evidence object is missing or expired' });
    const metadataError = privateEvidenceMetadataError(metadata);
    if (metadataError) return res.status(metadataError.status).json({ error: metadataError.message });
    expiresAt = signedEvidenceUrlExpiresAt(Date.now());
    url = await storage.privateDocumentUrl(event.evidenceKey, metadata.contentType, evidenceUrlTtlSeconds);
  } catch {
    return res.status(503).json({ error: 'Private evidence storage is temporarily unavailable' });
  }
  await audit(organizationId, req.auth!.userId, 'evidence.private_url_issued', 'ProctoringEvent', event.id, { contentType: metadata.contentType, contentLength: metadata.contentLength, expiresIn: evidenceUrlTtlSeconds });
  res.set({ 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer' });
  res.json({ url, contentType: metadata.contentType, contentLength: metadata.contentLength, expiresIn: evidenceUrlTtlSeconds, expiresAt: new Date(expiresAt).toISOString() });
} catch (error) { next(error); } });

app.post('/api/organizations/:organizationId/incidents/:incidentId/decision', authenticate, authorize('institute_admin', 'proctor'), async (req: AuthRequest, res, next) => { try {
  const data = z.object({ action: z.enum(['dismissed', 'resolved', 'escalated', 'awaiting_student']), reason: z.string().min(3).max(2000), notes: z.string().max(4000).optional() }).parse(req.body);
  const organizationId = req.auth!.organizationId!;
  const incidentId = String(req.params.incidentId);
  const config = await orgConfig(organizationId);
  const result = await prisma.$transaction(async tx => {
    const current = await tx.incident.findFirst({ where: { id: incidentId, organizationId } });
    if (!current) return { kind: 'not_found' as const };
    const notes = data.notes ?? null;
    if (current.status === data.action && current.decisionReason === data.reason && current.reviewerNotes === notes) return { kind: 'idempotent' as const, incident: current };
    if (!canTransitionIncident(current.status, data.action)) return { kind: 'conflict' as const, currentStatus: current.status };
    const updated = await tx.incident.updateMany({
      where: { id: incidentId, organizationId, status: current.status },
      data: { status: data.action, decisionReason: data.reason, reviewerNotes: notes, ...(data.action === 'awaiting_student' ? { explanationDeadlineAt: new Date(Date.now() + config.explanationDeadlineHours * 3600_000) } : {}) }
    });
    if (updated.count !== 1) {
      const latest = await tx.incident.findFirst({ where: { id: incidentId, organizationId } });
      if (latest?.status === data.action && latest.decisionReason === data.reason && latest.reviewerNotes === notes) return { kind: 'idempotent' as const, incident: latest };
      return { kind: 'conflict' as const, currentStatus: latest?.status };
    }
    const saved = await tx.incident.findUniqueOrThrow({ where: { id: incidentId } });
    if (data.action === 'awaiting_student' && saved.candidateId) {
      await tx.studentExplanation.upsert({
        where: { incidentId_candidateId: { incidentId: saved.id, candidateId: saved.candidateId } },
        update: { status: 'requested' },
        create: { organizationId, incidentId: saved.id, candidateId: saved.candidateId, status: 'requested' }
      });
    }
    await tx.auditLog.create({ data: { organizationId, actorId: req.auth!.userId, action: `incident.${data.action}`, targetType: 'Incident', targetId: saved.id, metadata: { reason: data.reason, notes, fromStatus: current.status, toStatus: data.action } as Prisma.InputJsonValue } });
    return { kind: 'updated' as const, incident: saved };
  });
  if (result.kind === 'not_found') return res.status(404).json({ error: 'Incident not found' });
  if (result.kind === 'conflict') return res.status(409).json({ error: 'Incident review state changed or this transition is no longer allowed. Refresh before deciding again.', currentStatus: result.currentStatus });
  res.json({ ...result.incident, idempotent: result.kind === 'idempotent' });
} catch (error) { next(error); } });
const explanationRequestInput = z.object({
  question: z.string().trim().min(3).max(2000),
  deadlineAt: z.string().datetime().optional(),
});
const explanationResponseInput = z.object({ body: z.string().trim().min(3).max(5000) });
const explanationDecisionInput = z.object({
  action: z.enum(['accepted', 'dismissed', 'escalated', 'follow_up']),
  reason: z.string().trim().min(3).max(2000),
  question: z.string().trim().min(3).max(2000).optional(),
});

app.post('/api/organizations/:organizationId/incidents/:incidentId/explanation-request', authenticate, authorize('institute_admin', 'proctor'), async (req: AuthRequest, res, next) => { try {
  const data = explanationRequestInput.parse(req.body);
  const organizationId = req.auth!.organizationId!;
  const incidentId = String(req.params.incidentId);
  const incident = await prisma.incident.findFirst({
    where: { id: incidentId, organizationId },
    include: { candidate: { select: { id: true, userId: true, name: true } }, exam: { select: { id: true, title: true } } },
  });
  if (!incident || !incident.candidate) return res.status(404).json({ error: 'Incident or candidate not found' });
  const deadlineAt = data.deadlineAt ? new Date(data.deadlineAt) : new Date(Date.now() + 72 * 3600_000);
  if (!validExplanationDeadline(deadlineAt)) return res.status(400).json({ error: 'Response deadline must be in the future and within 30 days' });
  const result = await prisma.$transaction(async tx => {
    const existing = await tx.studentExplanation.findUnique({ where: { incidentId_candidateId: { incidentId, candidateId: incident.candidate!.id } } });
    if (existing && existing.status !== 'closed') return { kind: 'exists' as const, explanation: existing };
    const explanation = existing
      ? await tx.studentExplanation.update({ where: { id: existing.id }, data: { question: data.question, followUpQuestion: null, deadlineAt, status: 'requested', requestedById: req.auth!.userId, reopenedAt: new Date(), decision: null, decisionReason: null, decisionAt: null, decidedById: null } })
      : await tx.studentExplanation.create({ data: { organizationId, incidentId, candidateId: incident.candidate!.id, requestedById: req.auth!.userId, question: data.question, deadlineAt, status: 'requested' } });
    const incidentUpdate = await tx.incident.updateMany({ where: { id: incidentId, organizationId, status: { in: ['open', 'escalated', 'awaiting_student'] } }, data: { status: 'awaiting_student', explanationDeadlineAt: deadlineAt } });
    if (incidentUpdate.count !== 1) return { kind: 'conflict' as const };
    await tx.auditLog.create({ data: { organizationId, actorId: req.auth!.userId, action: existing ? 'incident.explanation_reopened' : 'incident.explanation_requested', targetType: 'StudentExplanation', targetId: explanation.id, metadata: { incidentId, candidateId: incident.candidate!.id, deadlineAt, question: data.question } as Prisma.InputJsonValue } });
    return { kind: 'created' as const, explanation };
  });
  if (result.kind === 'exists') return res.status(409).json({ error: 'An active explanation request already exists for this incident' });
  if (result.kind === 'conflict') return res.status(409).json({ error: 'This incident can no longer accept an explanation request' });
  if (incident.candidate.userId) await notifyOnce(organizationId, incident.candidate.userId, 'explanation_requested', `Explanation requested: ${incident.exam?.title ?? 'examination'}`, `A reviewer has asked you to explain an examination event. Please respond by ${deadlineAt.toLocaleString()}.`, { explanationId: result.explanation.id });
  res.status(201).json(result.explanation);
} catch (error) { next(error); } });

app.get('/api/organizations/:organizationId/explanation-requests/:requestId', authenticate, authorize('institute_admin', 'proctor'), async (req: AuthRequest, res, next) => { try {
  const request = await prisma.studentExplanation.findFirst({
    where: { id: String(req.params.requestId), organizationId: req.auth!.organizationId! },
    include: { incident: { include: { exam: { select: { id: true, title: true } }, events: { include: { event: { select: { type: true, occurredAt: true, details: true } } } } } }, candidate: { select: { id: true, name: true, email: true } }, requestedBy: { select: { id: true, name: true } }, decidedBy: { select: { id: true, name: true } } },
  });
  if (!request) return res.status(404).json({ error: 'Explanation request not found' });
  res.json(request);
} catch (error) { next(error); } });

app.post('/api/organizations/:organizationId/explanation-requests/:requestId/decision', authenticate, authorize('institute_admin', 'proctor'), async (req: AuthRequest, res, next) => { try {
  const data = explanationDecisionInput.parse(req.body);
  const organizationId = req.auth!.organizationId!;
  const requestId = String(req.params.requestId);
  const result = await prisma.$transaction(async tx => {
    const current = await tx.studentExplanation.findFirst({ where: { id: requestId, organizationId } });
    if (!current) return { kind: 'not_found' as const };
    if (data.action === 'follow_up' && !data.question) return { kind: 'invalid' as const };
    if (current.status === 'closed') return { kind: 'closed' as const };
    const status = data.action === 'follow_up' ? 'follow_up' : 'closed';
    const updated = await tx.studentExplanation.update({ where: { id: current.id }, data: { status, decision: data.action === 'follow_up' ? null : data.action, decisionReason: data.reason, decisionAt: data.action === 'follow_up' ? null : new Date(), decidedById: req.auth!.userId, followUpQuestion: data.action === 'follow_up' ? data.question : null, question: data.action === 'follow_up' ? data.question! : current.question, deadlineAt: data.action === 'follow_up' ? new Date(Date.now() + 72 * 3600_000) : current.deadlineAt } });
    const incidentStatus = incidentStatusForExplanation(data.action);
    await tx.incident.update({ where: { id: current.incidentId }, data: { status: incidentStatus, decisionReason: data.reason, explanationDeadlineAt: data.action === 'follow_up' ? updated.deadlineAt : null } });
    await tx.auditLog.create({ data: { organizationId, actorId: req.auth!.userId, action: data.action === 'follow_up' ? 'incident.explanation_follow_up_requested' : `incident.explanation_${data.action}`, targetType: 'StudentExplanation', targetId: current.id, metadata: { incidentId: current.incidentId, reason: data.reason, question: data.question ?? null } as Prisma.InputJsonValue } });
    return { kind: 'updated' as const, explanation: updated };
  });
  if (result.kind === 'not_found') return res.status(404).json({ error: 'Explanation request not found' });
  if (result.kind === 'invalid') return res.status(400).json({ error: 'A follow-up question is required' });
  if (result.kind === 'closed') return res.status(409).json({ error: 'This explanation request is already closed' });
  const request = await prisma.studentExplanation.findUniqueOrThrow({ where: { id: result.explanation.id }, include: { candidate: { select: { userId: true } }, incident: { select: { examId: true } } } });
  if (request.candidate.userId) await notifyOnce(organizationId, request.candidate.userId, data.action === 'follow_up' ? 'explanation_follow_up' : 'explanation_decision', data.action === 'follow_up' ? 'Additional information requested' : 'Explanation request reviewed', data.action === 'follow_up' ? 'A reviewer requested additional information about your explanation.' : 'A reviewer recorded a decision on your explanation request.', { explanationId: request.id });
  res.json(result.explanation);
} catch (error) { next(error); } });

app.get('/api/student/explanation-requests', authenticate, async (req: AuthRequest, res, next) => { try {
  const memberships = await prisma.membership.findMany({ where: { userId: req.auth!.userId, active: true }, select: { organizationId: true } });
  const candidate = await prisma.candidate.findFirst({ where: { userId: req.auth!.userId, organizationId: { in: memberships.map(membership => membership.organizationId) } }, select: { id: true, organizationId: true } });
  if (!candidate) return res.status(403).json({ error: 'Candidate access required' });
  const requests = await prisma.studentExplanation.findMany({ where: { organizationId: candidate.organizationId, candidateId: candidate.id }, orderBy: { createdAt: 'desc' }, include: { incident: { include: { exam: { select: { id: true, title: true } } } }, decidedBy: { select: { name: true } } } });
  res.json(requests);
} catch (error) { next(error); } });

app.post('/api/student/explanation-requests/:requestId/response', authenticate, upload.single('file'), validateOptionalFileContent, async (req: AuthRequest, res, next) => { try {
  const data = explanationResponseInput.parse(req.body);
  const request = await prisma.studentExplanation.findUnique({ where: { id: String(req.params.requestId) }, include: { incident: { select: { organizationId: true, examId: true } }, candidate: { select: { id: true, userId: true, organizationId: true } }, requestedBy: { select: { id: true } } } });
  if (!request || request.candidate.userId !== req.auth!.userId || request.candidate.organizationId !== request.incident.organizationId) return res.status(404).json({ error: 'Explanation request not found' });
  if (!explanationResponseOpen(request.status, request.deadlineAt)) return res.status(409).json({ error: 'This explanation request is no longer accepting a response' });
  let evidenceKey: string | null = request.evidenceKey;
  if (req.file) {
    const storage = req.app.get('storage') as StorageInterface;
    if (!storage.storageConfigured()) return res.status(503).json({ error: 'Private evidence storage is not configured' });
    evidenceKey = `organizations/${request.candidate.organizationId}/candidates/${request.candidate.id}/explanations/${request.id}-${Date.now()}`;
    await storage.putPrivateDocument(evidenceKey, req.file.buffer, req.file.mimetype);
  }
  const updated = await prisma.studentExplanation.updateMany({ where: { id: request.id, status: request.status }, data: { body: data.body, evidenceKey, status: 'responded', respondedAt: new Date() } });
  if (updated.count !== 1) return res.status(409).json({ error: 'The request changed while your response was being submitted' });
  await audit(request.incident.organizationId, req.auth!.userId, 'incident.explanation_submitted', 'StudentExplanation', request.id);
  if (request.requestedBy?.id) await notifyOnce(request.incident.organizationId, request.requestedBy.id, 'explanation_response_received', 'Student response received', 'A student submitted an explanation for an incident you requested.', { explanationId: request.id });
  res.json(await prisma.studentExplanation.findUniqueOrThrow({ where: { id: request.id } }));
} catch (error) { next(error); } });

app.get('/api/student/explanation-requests/:requestId/attachment', authenticate, async (req: AuthRequest, res, next) => { try {
  const request = await prisma.studentExplanation.findUnique({
    where: { id: String(req.params.requestId) },
    select: { evidenceKey: true, organizationId: true, candidate: { select: { userId: true } } },
  });
  if (!request || request.candidate.userId !== req.auth!.userId || request.organizationId !== req.auth!.organizationId) return res.status(404).end();
  if (!request.evidenceKey) return res.status(404).end();
  const storage = req.app.get('storage') as StorageInterface;
  if (!storage.getPrivateDocument) return res.status(404).end();
  const bytes = await storage.getPrivateDocument(request.evidenceKey);
  if (!bytes) return res.status(404).end();
  res.set({ 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length), 'Cache-Control': 'private, no-store', 'Content-Disposition': 'attachment; filename="explanation-attachment"' });
  return res.status(200).send(bytes);
} catch (error) { next(error); } });

app.post('/api/student/incidents/:incidentId/explanation', authenticate, async (req: AuthRequest, res, next) => { try {
  const request = await prisma.studentExplanation.findFirst({ where: { incidentId: String(req.params.incidentId), candidate: { userId: req.auth!.userId } } });
  if (!request) return res.status(404).json({ error: 'Explanation request not found' });
  req.body = { body: req.body.body };
  const data = explanationResponseInput.parse(req.body);
  if (!explanationResponseOpen(request.status, request.deadlineAt)) return res.status(409).json({ error: 'This explanation request is no longer accepting a response' });
  const updated = await prisma.studentExplanation.update({ where: { id: request.id }, data: { body: data.body, status: 'responded', respondedAt: new Date() } });
  await audit(request.organizationId, req.auth!.userId, 'incident.explanation_submitted', 'StudentExplanation', request.id);
  res.json(updated);
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
  const existingGrade = await prisma.grade.findUnique({ where: { attemptId: attempt.id } });
  // A released result is final: re-grading must not silently un-publish it or discard manual marks.
  if (existingGrade?.status === 'published') return res.status(409).json({ error: 'This result is already published and cannot be re-graded' });
  const status = gradeStatusAfterAuto(automatic.needsManual, existingGrade?.status);
  const grade = await prisma.grade.upsert({
    where: { attemptId: attempt.id },
    update: { autoMarks: automatic.marks, totalMarks: totalMarks(automatic.marks, existingGrade?.manualMarks), maxMarks, status },
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
  if (!manualMarksWithinBounds(existing.autoMarks, data.manualMarks, existing.maxMarks)) return res.status(400).json({ error: `Manual marks must keep the total within the maximum of ${existing.maxMarks}` });
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
  const organizationId = req.auth!.organizationId!;
  if (req.query.examId !== undefined && !isUuid(req.query.examId)) return res.status(400).json({ error: 'Invalid examId' });
  const examId = isUuid(req.query.examId) ? req.query.examId : undefined;
  const grades = await prisma.grade.findMany({ where: { organizationId, ...(examId ? { examId } : {}) }, include: { candidate: { select: { name: true } } }, orderBy: { createdAt: 'asc' }, take: 10_000 });
  // Results contain personal data: every export is audited.
  await audit(organizationId, req.auth!.userId, 'reports.exported', 'Report', organizationId, { rows: grades.length, examId: examId ?? null, format: 'csv' });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="examguard-results.csv"');
  res.send(toCsv(['candidate', 'score', 'max_marks', 'status'], grades.map(g => [g.candidate.name, g.totalMarks, g.maxMarks, g.status])));
} catch (error) { next(error); } });
app.get('/api/notifications', authenticate, async (req: AuthRequest, res, next) => { try {
  const emailConfigured = !!emailProviderFromEnv();
  res.json({ emailConfigured, emailStatus: emailConfigured ? 'configured' : 'unavailable: set EMAIL_PROVIDER, EMAIL_URL and EMAIL_FROM to enable email', notifications: await prisma.notification.findMany({ where: { userId: req.auth!.userId }, orderBy: { createdAt: 'desc' }, take: 50 }) });
} catch (error) { next(error); } });
app.post('/api/notifications/:id/read', authenticate, async (req: AuthRequest, res, next) => { try {
  const id = String(req.params.id);
  const marked = await prisma.notification.updateMany({ where: { id, userId: req.auth!.userId }, data: { readAt: new Date() } });
  if (marked.count === 0) return res.status(404).json({ error: 'Notification not found' });
  res.json(await prisma.notification.findUniqueOrThrow({ where: { id } }));
} catch (error) { next(error); } });
registerOpsRoutes(app);
registerAnalyticsRoutes(app);
registerReviewRoutes(app);
registerEmailRoutes(app);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input', details: error.flatten() });
  if (error instanceof multer.MulterError) return res.status(uploadErrorHttpStatus(error.code)).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'File exceeds the 5 MB upload limit' : 'Invalid upload' });
  if (error instanceof Error && error.message === 'Unexpected end of form') return res.status(400).json({ error: 'Malformed multipart upload' });
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const mapped = prismaErrorResponse(error.code);
    if (mapped) return res.status(mapped.status).json({ error: mapped.message });
  }
  console.error(error);
  res.status(500).json({ error: 'Unexpected server error' });
});

  return app;
}
