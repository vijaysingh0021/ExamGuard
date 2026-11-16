import express from 'express';
import crypto from 'node:crypto';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { authenticate, authenticateCompanion, authorize, authorizePlatformAdmin, signCompanionToken, signToken, tenantFilter, type AuthRequest, type CompanionClaims } from './auth.js';
import { canStartExam, deadlineFor, isAttemptOpen, submissionStatusAt } from './exam.js';
import { StorageInterface, realStorage, verifyPrivateEvidenceToken } from './storage.js';
import { dedupeWindow, fingerprintFor, reviewPriority } from './proctor.js';
import { aiSignalsForFrame } from './ai-monitoring.js';
import { radioProximity, supportsPotentialVisualAssistance } from './radio-proximity.js';
import { radioObservationSelect, withAdvertisedNameCompatibility } from './radio-observation.js';
import { registerOpsRoutes } from './ops-routes.js';
import { registerReviewRoutes } from './review-routes.js';
import { registerEmailRoutes } from './email-routes.js';
import { emailProviderFromEnv } from './email.js';
import { registerAnalyticsRoutes } from './analytics-routes.js';
import { registerStudentInvitationRoutes } from './student-invitation-routes.js';
import { registerSupportRoutes } from './support-routes.js';
import { toCsv } from './csv.js';
import { evaluateQuota, parseQuotaBytes } from './quota.js';
import { securityHeaders } from './security-headers.js';
import { automaticallyGrade, gradeStatusAfterAuto, manualMarksWithinBounds, totalMarks } from './grading.js';
import { createOtp, createResetToken, hashResetToken, otpConfig, passwordPolicy } from './password-reset.js';
import { sendPasswordChangeConfirmationEmail, sendPasswordOtpEmail, sendSignupOtpEmail } from './mailer.js';
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
import { checkAiService, checkEvidenceStorage, readinessSummary, readinessCheck } from './readiness.js';
import { candidateListQuerySchema, candidateWhere, incidentListQuerySchema, incidentWhere, memberUpdateSchema, paginationHeaders, paginationOffset, questionOrderMatches, questionOrderSchema, memberCanBeManaged, wouldRemoveLastActiveAdmin, organizationApiRoles, prismaErrorResponse } from './organization-api.js';
import { evidenceInventoryQuerySchema, evidenceReviewerRoles, evidenceUrlTtlSeconds, incidentReviewStatus, radioReviewStatus, canTransitionIncident, canTransitionRadio, evidencePaginationHeaders, evidenceOffset, privateEvidenceMetadataError, evidenceKeyMatchesAttempt, evidenceAttemptScopeMatches, uploadErrorHttpStatus, signedEvidenceUrlExpiresAt, sanitizeEvidenceDetails } from './evidence-api.js';
import { codingExecutionRequest, codingQuestionInput, codingRateLimits, codingTestCaseInput } from './coding-contracts.js';
import { judge0AdapterFromEnv, judge0LanguageIdsFromEnv } from './judge0-adapter.js';
import { aggregateExecutionStatus, candidateExecutionResults, executeCodingCases } from './coding-execution-service.js';
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

const coordinatorApplication = z.object({ name: z.string().trim().min(2).max(120), email: z.string().email().transform(value => value.toLowerCase()), password: z.string().min(10), organizationId: z.string().uuid(), verificationTicket: z.string().min(40).max(100) });
const signupPurpose = z.enum(['student', 'coordinator', 'institution_admin']);
const signupHash = (value: string) => crypto.createHmac('sha256', loadConfig().JWT_SECRET).update(value).digest('hex');
const sameHash = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};
const credentials = z.object({ email: z.string().email().transform(value => value.toLowerCase()), password: z.string().min(1) });
const resetRequest = z.object({ email: z.string().email().transform(value => value.toLowerCase()) });
const passwordResetOtp = resetRequest.extend({ otp: z.string().regex(/^\d{6}$/) });
const resetPassword = z.object({ token: z.string().min(20).max(200), password: z.string().min(10), confirmPassword: z.string() }).refine(data => data.password === data.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] });
const examInput = z.object({ title: z.string().min(3), instructions: z.string().max(10000).default(''), durationMinutes: z.number().int().positive().default(60), startsAt: z.string().datetime().optional(), endsAt: z.string().datetime().optional(), randomizeQuestions: z.boolean().default(false), randomizeOptions: z.boolean().default(false), isPractice: z.boolean().default(false), interventionPolicy: z.object({ windowSeconds: z.number().int().min(30).max(3600).default(300), warningAt: z.number().int().min(1).default(1), pauseAt: z.number().int().min(2).default(3), terminateAt: z.number().int().min(3).default(5), automaticTerminationEnabled: z.boolean().default(false), fullscreenRequired: z.boolean().default(true) }).default({ windowSeconds: 300, warningAt: 1, pauseAt: 3, terminateAt: 5, automaticTerminationEnabled: false, fullscreenRequired: true }), accessCode: z.string().min(4).optional() });
const questionInput = z.object({
  type: z.enum(['mcq', 'multiple_select', 'true_false', 'short_answer', 'descriptive', 'coding']),
  prompt: z.string().min(1),
  options: z.array(z.object({ id: z.string(), text: z.string() })).default([]),
  correctAnswer: z.unknown().optional(),
  marks: z.number().positive(),
  negativeMarks: z.number().min(0).default(0),
  coding: codingQuestionInput.optional(),
  codingTestCases: z.array(codingTestCaseInput).max(100).default([]),
}).superRefine((data, ctx) => {
  if (data.type === 'coding' && !data.coding) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['coding'], message: 'Coding question details are required' });
});
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
const codingQuestionFields = (data: z.infer<typeof codingQuestionInput>) => ({
  title: data.title,
  description: data.description,
  difficulty: data.difficulty,
  mode: data.mode,
  inputFormat: data.inputFormat,
  outputFormat: data.outputFormat,
  constraints: data.constraints,
  explanation: data.explanation,
  languageIds: data.languageIds,
  starterCode: data.starterCode,
  timeLimitMs: data.timeLimitMs,
  memoryLimitKb: data.memoryLimitKb,
  comparisonMode: data.comparisonMode,
});
const orgConfig = (organizationId: string) => prisma.proctoringConfig.upsert({ where: { organizationId }, update: {}, create: { organizationId } });
const shuffle = <T>(items: T[]) => { const copy = [...items]; for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; } return copy; };
const proctorEventInput = z.object({ examId: z.string().uuid(), candidateId: z.string().uuid(), sessionId: z.string().uuid().optional(), attemptId: z.string().uuid(), type: z.enum(['face_missing', 'multiple_faces', 'looking_away', 'phone_detected', 'camera_obstructed', 'visibility_hidden', 'fullscreen_exit', 'window_blur', 'focus_regain', 'multiple_window_hint', 'network_interruption', 'camera_permission_lost', 'screen_sharing_stopped']), occurredAt: z.string().datetime(), source: z.literal('browser'), details: z.record(z.unknown()).optional(), evidenceKey: z.string().max(512).optional() });
const radioObservationInput = z.object({ organizationId: z.string().uuid(), examId: z.string().uuid(), candidateId: z.string().uuid(), attemptId: z.string().uuid(), source: z.enum(['bluetooth_le', 'wifi', 'scanner_health']), kind: z.enum(['advertisement', 'access_point', 'heartbeat', 'scan_unavailable', 'permission_denied', 'scan_error', 'scan_stopped']), rssi: z.number().int().min(-127).max(0).optional(), pseudonym: z.string().min(16).max(128).optional(), advertisedName: z.string().trim().min(1).max(80).refine(value => !/[\u0000-\u001f\u007f]/.test(value), 'Advertised name contains invalid control characters').optional(), scannerStatus: z.enum(['active', 'unavailable', 'permission_denied', 'stopped', 'error']), errorCode: z.string().max(120).optional() }).superRefine((data, ctx) => { if (data.kind === 'advertisement' || data.kind === 'access_point') { if (!data.pseudonym) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A session-scoped pseudonym is required for a radio observation' }); if (data.scannerStatus !== 'active') ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Radio observations require an active scanner status' }); } if (data.advertisedName && data.source !== 'bluetooth_le') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['advertisedName'], message: 'Advertised names are accepted only from Bluetooth LE' }); });

const aiFrameSchema = z.object({
  face_presence: z.boolean(),
  face_count: z.number().int().min(0).max(20),
  face_boxes: z.array(z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number(), confidence: z.number().min(0).max(1).nullable() })).max(20).default([]),
  face_pose_estimates: z.array(z.object({
    face_box: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number(), confidence: z.number().min(0).max(1).nullable() }),
    head_pose: z.object({ yaw_degrees: z.number(), pitch_degrees: z.number(), roll_degrees: z.number() }).nullable(),
    looking_away: z.enum(['looking_away', 'looking_forward', 'unavailable']),
  })).max(20).default([]),
  multiple_faces: z.boolean(),
  looking_away: z.enum(['looking_away', 'looking_forward', 'unavailable']),
  head_pose: z.object({ yaw_degrees: z.number(), pitch_degrees: z.number(), roll_degrees: z.number() }).nullable().optional(),
  phone_detection: z.enum(['detected', 'not_detected', 'unavailable']),
  phone_confidence: z.number().min(0).max(1).nullable().optional(),
  phone_boxes: z.array(z.object({ x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(), confidence: z.number().min(0).max(1), label: z.string().max(80) })).max(20).default([]),
  visible_devices: z.array(z.object({
    kind: z.enum(['phone', 'tablet', 'laptop', 'screen']),
    label: z.string().max(80),
    confidence: z.number().min(0).max(1),
    box: z.array(z.number()).length(4),
  })).max(30).default([]),
  readability_assessment: z.object({
    status: z.enum(['potentially_readable', 'not_indicated']),
    confidence: z.enum(['low']),
    basis: z.string().max(500),
    devices: z.array(z.object({
      kind: z.enum(['phone', 'tablet', 'laptop', 'screen']),
      label: z.string().max(80),
      confidence: z.number().min(0).max(1),
      box: z.array(z.number()).length(4),
      visible: z.boolean(),
      estimated_distance_band: z.enum(['near', 'medium', 'far']),
      screen_bearing_from_face_degrees: z.number().nullable(),
      view_alignment: z.enum(['roughly_aligned', 'not_indicated', 'unavailable']),
      estimated_text_height_px: z.number().nonnegative(),
      potentially_readable: z.boolean(),
    })).max(30),
    limitations: z.string().max(1000),
  }).optional(),
  proximity_context: z.array(z.object({
    source: z.enum(['bluetooth_le', 'wifi']),
    kind: z.string().max(40),
    rssi: z.number().int().nullable(),
    pseudonym: z.string().max(128).nullable(),
    advertisedName: z.string().max(80).nullable(),
    advertisedNameAvailable: z.boolean(),
    observedAt: z.string().datetime(),
    proximity: z.object({
      band: z.enum(['near', 'medium', 'far', 'unknown']),
      confidence: z.enum(['low', 'unavailable']),
      calibration: z.string().max(80),
    }),
    association: z.literal('temporal_only_device_not_linked'),
  })).max(20).optional(),
  advertised_name_storage_available: z.boolean().optional(),
  potential_visual_assistance: z.object({
    flagged: z.boolean(),
    confidence: z.enum(['low']),
    rationale: z.string().max(500),
  }).optional(),
  camera_health: z.enum(['ok', 'obstructed']).default('ok'),
  frame_quality: z.object({ mean_luminance: z.number(), luminance_stddev: z.number() }).optional(),
  inference_ms: z.number().nonnegative().optional(),
  disclosure: z.string().max(1000).optional(),
  service_version: z.string().max(80).optional(),
  phone_model: z.string().max(40).optional()
}).strict();
const aiFrameLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });
export function createApp(storageImpl?: StorageInterface): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  const codeRunner = judge0AdapterFromEnv();
  const judge0LanguageIds = judge0LanguageIdsFromEnv();
  const storage = storageImpl ?? realStorage;
  const clientOrigin = new URL(process.env.CLIENT_URL?.trim() || 'http://localhost:5173').origin;

  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(cors({
  origin: clientOrigin,
  credentials: true,
  exposedHeaders: [
    'X-Page',
    'X-Page-Size',
    'X-Total-Count',
    'X-Total-Pages',
    'Date'
  ]
}));
  app.set('storage', storage);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use('/api/auth', rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false }));
  const passwordResetLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false });
  const signupEmailLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false });
  const directoryLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
  const radioObservationLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false });
  const codingRunLimiter = rateLimit({ windowMs: codingRateLimits.run.windowMs, limit: codingRateLimits.run.limit, standardHeaders: 'draft-7', legacyHeaders: false });
  const codingSubmitLimiter = rateLimit({ windowMs: codingRateLimits.submit.windowMs, limit: codingRateLimits.submit.limit, standardHeaders: 'draft-7', legacyHeaders: false });
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: 'draft-7', legacyHeaders: false }));
  for (const name of ['organizationId', 'examId', 'candidateId', 'attemptId', 'questionId', 'incidentId', 'signalId', 'gradeId', 'userId', 'evidenceId', 'invitationId', 'ticketId', 'id']) {
    app.param(name, (_req, res, next, value) => (isUuid(value) ? next() : res.status(404).json({ error: 'Not found' })));
  }
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get(['/api/local-evidence/:token', '/api/private-evidence/:token'], async (req, res, next) => {
    let key: string;
    try {
      key = verifyPrivateEvidenceToken(String(req.params.token));
    } catch {
      return res.status(404).end();
    }
    try {
      if (!key.startsWith('organizations/')) return res.status(404).end();
      const object = await prisma.evidenceObject.findUnique({ where: { objectKey: key }, select: { organizationId: true, attemptId: true, mimeType: true, sizeBytes: true } });
      const staffDocument = object ? null : await prisma.staffVerificationRequest.findFirst({ where: { OR: [{ governmentIdDocument: key }, { institutionIdDocument: key }, { authorizationDocument: key }] }, select: { id: true } });
      const verificationDocument = object || staffDocument ? null : await prisma.verificationRequest.findFirst({ where: { OR: [{ profilePhoto: key }, { idDocument: key }] }, select: { id: true } });
      const institutionDocument = object || staffDocument || verificationDocument ? null : await prisma.institutionRequest.findFirst({ where: { OR: [{ governmentIdDocument: key }, { institutionIdDocument: key }, { authorizationLetterDocument: key }] }, select: { id: true } });
      if ((!object || !evidenceKeyMatchesAttempt(key, object.organizationId, object.attemptId)) && !staffDocument && !verificationDocument && !institutionDocument) return res.status(404).end();
      const storage = req.app.get('storage') as StorageInterface;
      if (!storage.getPrivateDocument) return res.status(404).end();
      const bytes = await storage.getPrivateDocument(key);
      const metadata = object ? null : await storage.privateDocumentMetadata?.(key);
      if (!bytes || (object && bytes.length !== object.sizeBytes) || (metadata?.contentLength !== undefined && bytes.length !== metadata.contentLength)) return res.status(404).end();
      const headers: Record<string, string> = {
        'Content-Type': object?.mimeType ?? metadata?.contentType ?? 'application/octet-stream',
        'Content-Length': String(bytes.length),
        'Cache-Control': 'private, no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
      };
      if (req.path.startsWith('/api/private-evidence/')) {
        headers['Cross-Origin-Resource-Policy'] = 'cross-origin';
      }
      res.set(headers);
      return res.status(200).send(bytes);
    } catch (error) { next(error); }
  });

  app.get('/api/student/monitoring-readiness', authenticate, async (req: AuthRequest, res) => {
    const storage = req.app.get('storage') as StorageInterface;
    const [ai, evidenceStorage] = await Promise.all([checkAiService(), checkEvidenceStorage(storage)]);
    const checks = [ai.check, evidenceStorage];
    const summary = readinessSummary(checks);
    res.status(summary.ready ? 200 : 503).json({
      ...summary,
      checks,
      evidenceStorageReady: evidenceStorage.status === 'ready',
      aiService: ai.check.status === 'ready' ? 'ready' : ai.check.status,
      error: checks.find(check => check.status !== 'ready')?.explanation,
      capabilities: ai.capabilities,
      note: 'Head orientation is an approximate review signal, not eye-gaze tracking.',
    });
  });
  app.get('/api/student/organizations/:organizationId/exams/:examId/readiness', authenticate, async (req: AuthRequest, res, next) => { try {
    const organizationId = String(req.params.organizationId);
    const examId = String(req.params.examId);
    const [candidate, exam] = await Promise.all([
      prisma.candidate.findFirst({ where: { organizationId, userId: req.auth!.userId }, select: { id: true } }),
      prisma.exam.findFirst({ where: { id: examId, organizationId }, select: { id: true, status: true, startsAt: true, endsAt: true } }),
    ]);
    if (!candidate || !exam) return res.status(403).json({ error: 'Authorized candidate and examination required.' });
    const assignment = await prisma.examAssignment.findUnique({ where: { examId_candidateId: { examId, candidateId: candidate.id } }, select: { id: true } });
    const now = new Date();
    const examCanStart = ['published', 'scheduled', 'live'].includes(exam.status) && canStartExam(now, exam.startsAt ?? undefined, exam.endsAt ?? undefined);
    const examStatus = examCanStart ? 'ready' : exam.startsAt && exam.startsAt > now ? 'pending' : 'failed';
    const storage = req.app.get('storage') as StorageInterface;
    const [ai, evidenceStorage] = await Promise.all([checkAiService(), checkEvidenceStorage(storage)]);
    const checks = [
      readinessCheck('exam_assignment', assignment ? 'ready' : 'failed', assignment ? 'You are assigned to this examination.' : 'You are not assigned to this examination.', 'Contact your examination organizer to confirm your assignment.', now),
      readinessCheck('exam_window', examStatus, examCanStart ? 'The examination is open for starting.' : examStatus === 'pending' ? 'The examination start time has not arrived.' : 'The examination is not currently available.', 'Start during the scheduled examination window or contact your organizer.', now),
      ai.check,
      evidenceStorage,
    ];
    const summary = readinessSummary(checks);
    res.status(summary.ready ? 200 : 503).json({ ...summary, checks, capabilities: ai.capabilities });
  } catch (error) { next(error); } });

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
  app.get('/api/public/organizations', directoryLimiter, async (req, res, next) => { try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (search.length < 2 || search.length > 100) return res.status(400).json({ error: 'Enter 2 to 100 characters to search institutions.' });
    const organizations = await prisma.organization.findMany({ where: { status: 'active', name: { contains: search, mode: 'insensitive' } }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 20 });
    res.json(organizations);
  } catch (error) { next(error); } });
  app.post('/api/public/signup-email/request', signupEmailLimiter, async (req, res, next) => { try {
    const data = z.object({
      email: z.string().email().transform(value => value.toLowerCase()),
      purpose: signupPurpose,
      organizationId: z.string().uuid().optional(),
    }).superRefine((value, context) => {
      if (value.purpose !== 'institution_admin' && !value.organizationId) context.addIssue({ code: 'custom', message: 'Select an active institution.' });
      if (value.purpose === 'institution_admin' && value.organizationId) context.addIssue({ code: 'custom', message: 'Institution administrator verification does not use an institution ID.' });
    }).parse(req.body);
    if (!emailProviderFromEnv()) return res.status(503).json({ error: 'Email verification is unavailable because email delivery is not configured.' });
    if (data.organizationId) {
      const organization = await prisma.organization.findFirst({ where: { id: data.organizationId, status: 'active' }, select: { id: true } });
      if (!organization) return res.status(404).json({ error: 'Select an active ExamGuard institution.' });
    }
    const user = await prisma.user.findUnique({ where: { email: data.email }, select: { id: true } });
    const candidate = data.purpose === 'student' && data.organizationId
      ? await prisma.candidate.findUnique({ where: { organizationId_email: { organizationId: data.organizationId, email: data.email } }, select: { id: true } })
      : null;
    const priorInstitutionRequest = data.purpose === 'institution_admin'
      ? await prisma.institutionRequest.findFirst({ where: { requesterEmail: data.email, status: { in: ['submitted', 'under_review'] } }, select: { id: true } })
      : null;
    if (user || candidate || priorInstitutionRequest) return res.status(202).json({ message: 'If this address is eligible, a verification code will be sent.' });
    const now = new Date();
    const organizationId = data.organizationId ?? null;
    const active = await prisma.signupEmailChallenge.findFirst({
      where: { email: data.email, purpose: data.purpose, organizationId, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (active && now.getTime() - active.lastSentAt.getTime() < 60_000) return res.status(429).json({ error: 'Wait one minute before requesting another verification code.' });
    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    await prisma.$transaction(async tx => {
      await tx.signupEmailChallenge.updateMany({ where: { email: data.email, purpose: data.purpose, organizationId, consumedAt: null }, data: { consumedAt: now } });
      await tx.signupEmailChallenge.create({
        data: { email: data.email, purpose: data.purpose, organizationId, codeHash: signupHash(code), expiresAt: new Date(now.getTime() + 10 * 60_000), lastSentAt: now },
      });
    });
    const challenge = await prisma.signupEmailChallenge.findFirstOrThrow({ where: { email: data.email, purpose: data.purpose, organizationId, consumedAt: null }, orderBy: { createdAt: 'desc' } });
    try {
      await sendSignupOtpEmail(data.email, code);
    } catch (error) {
      await prisma.signupEmailChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { consumedAt: new Date() } });
      console.error('Signup email verification delivery failed:', error instanceof Error ? error.message : 'Unknown email error');
      return res.status(503).json({ error: 'The verification email could not be delivered. Please try again later.' });
    }
    res.status(202).json({ message: 'If this address is eligible, a verification code will be sent.' });
  } catch (error) { next(error); } });
  app.post('/api/public/signup-email/verify', signupEmailLimiter, async (req, res, next) => { try {
    const data = z.object({
      email: z.string().email().transform(value => value.toLowerCase()),
      purpose: signupPurpose,
      organizationId: z.string().uuid().optional(),
      code: z.string().regex(/^\d{6}$/),
    }).parse(req.body);
    const organizationId = data.organizationId ?? null;
    const challenge = await prisma.signupEmailChallenge.findFirst({
      where: { email: data.email, purpose: data.purpose, organizationId, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    const now = new Date();
    if (!challenge || challenge.expiresAt <= now || challenge.attempts >= 5 || challenge.verifiedAt) return res.status(400).json({ error: 'The verification code is invalid, expired, or already used.' });
    if (!sameHash(signupHash(data.code), challenge.codeHash)) {
      await prisma.signupEmailChallenge.updateMany({ where: { id: challenge.id, consumedAt: null, attempts: { lt: 5 } }, data: { attempts: { increment: 1 } } });
      return res.status(400).json({ error: 'The verification code is invalid, expired, or already used.' });
    }
    const ticket = crypto.randomBytes(32).toString('base64url');
    const verified = await prisma.signupEmailChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null, verifiedAt: null, expiresAt: { gt: now }, attempts: { lt: 5 } },
      data: { verifiedAt: now, verificationTokenHash: signupHash(ticket) },
    });
    if (!verified.count) return res.status(400).json({ error: 'The verification code is invalid, expired, or already used.' });
    res.json({ ticket });
  } catch (error) { next(error); } });
  app.post('/api/public/student-applications', directoryLimiter, upload.single('idDocument'), validateOptionalFileContent, async (req, res, next) => { try {
   const data = z.object({
     name: z.string().trim().min(2).max(120),
     email: z.string().email().transform(value => value.toLowerCase()),
     password: z.string().min(10),
     organizationId: z.string().uuid(),
     verificationTicket: z.string().min(40).max(100),
   }).parse(req.body);
   if (!passwordPolicy(data.password)) return res.status(400).json({ error: 'Password must contain upper and lower case letters, a number, and be at least 10 characters.' });
   const idDocument = req.file;
   if (!idDocument) return res.status(400).json({ error: 'Upload a government-issued ID document.' });
   const organization = await prisma.organization.findFirst({ where: { id: data.organizationId, status: 'active' }, select: { id: true } });
   if (!organization) return res.status(404).json({ error: 'Select an active ExamGuard institution.' });
   const [existingUser, existingCandidate] = await Promise.all([
     prisma.user.findUnique({ where: { email: data.email }, select: { id: true } }),
     prisma.candidate.findUnique({ where: { organizationId_email: { organizationId: data.organizationId, email: data.email } }, select: { id: true } }),
   ]);
   if (existingUser || existingCandidate) return res.status(409).json({ error: 'This email already has an ExamGuard account or student profile.' });
   const storage = req.app.get('storage') as StorageInterface;
   if (!storage.storageConfigured()) return res.status(503).json({ error: 'Private document storage is not configured. Contact your institution administrator.' });
   const candidateId = crypto.randomUUID();
   const idDocumentKey = `organizations/${organization.id}/student-applications/${candidateId}/government-id`;
   await storage.putPrivateDocument(idDocumentKey, idDocument.buffer, idDocument.mimetype);
   const passwordHash = await bcrypt.hash(data.password, 12);
   const created = await prisma.$transaction(async tx => {
     const now = new Date();
     const consumed = await tx.signupEmailChallenge.updateMany({
       where: { email: data.email, purpose: 'student', organizationId: data.organizationId, verificationTokenHash: signupHash(data.verificationTicket), verifiedAt: { not: null }, expiresAt: { gt: now }, consumedAt: null },
       data: { consumedAt: now },
     });
     if (!consumed.count) return null;
     const createdUser = await tx.user.create({
       data: { name: data.name, email: data.email, passwordHash },
     });
     await tx.membership.create({
       data: { userId: createdUser.id, organizationId: data.organizationId, role: 'student', active: false },
     });
     const candidate = await tx.candidate.create({
       data: { id: candidateId, organizationId: data.organizationId, userId: createdUser.id, name: data.name, email: data.email, emailVerifiedAt: now },
     });
     await tx.verificationRequest.create({
       data: {
         organizationId: data.organizationId,
         candidateId: candidate.id,
         status: 'submitted',
         idDocument: idDocumentKey,
         submittedAt: now,
       },
     });
     return createdUser;
   });
   if (!created) return res.status(400).json({ error: 'Verify your email again before submitting this application.' });
   await audit(data.organizationId, created.id, 'student_application.submitted', 'Candidate', candidateId);
   res.status(201).json({ status: 'submitted', message: 'Your application is awaiting approval by your institution.' });
  } catch (error) {
   if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return res.status(409).json({ error: 'This email already has an ExamGuard account or student profile.' });
   next(error);
  } });
  app.post('/api/auth/coordinator-applications', directoryLimiter, upload.fields([
    { name: 'governmentIdDocument', maxCount: 1 },
    { name: 'institutionIdDocument', maxCount: 1 },
    { name: 'authorizationDocument', maxCount: 1 },
  ]), async (req, res, next) => { try {
    const data = coordinatorApplication.parse(req.body);
    if (!passwordPolicy(data.password)) return res.status(400).json({ error: 'Password must contain upper and lower case letters, a number, and be at least 10 characters.' });
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const kinds = ['governmentIdDocument', 'institutionIdDocument', 'authorizationDocument'] as const;
    const documents = kinds.map(kind => files?.[kind]?.[0]);
    if (documents.some(file => !file)) return res.status(400).json({ error: 'Upload a government ID, institution ID, and university authorization letter.' });
    for (const file of documents) {
      if (!file || !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.mimetype)) return res.status(415).json({ error: 'Proof files must be JPEG, PNG, WebP, or PDF.' });
      const valid = file.mimetype === 'application/pdf' ? isSupportedIdentityDocument(file.mimetype, file.buffer) : isSupportedImage(file.mimetype, file.buffer);
      if (!valid) return res.status(422).json({ error: 'A proof file does not match its declared file type.' });
    }
    const [organization, existingUser] = await Promise.all([
      prisma.organization.findFirst({ where: { id: data.organizationId, status: 'active' }, select: { id: true, name: true } }),
      prisma.user.findUnique({ where: { email: data.email }, select: { id: true } }),
    ]);
    if (!organization) return res.status(404).json({ error: 'Select an active ExamGuard institution.' });
    if (existingUser) return res.status(409).json({ error: 'This email already has an ExamGuard account. Sign in or contact your institution administrator.' });
    const validTicket = await prisma.signupEmailChallenge.findFirst({ where: { email: data.email, purpose: 'coordinator', organizationId: organization.id, verificationTokenHash: signupHash(data.verificationTicket), verifiedAt: { not: null }, expiresAt: { gt: new Date() }, consumedAt: null } });
    if (!validTicket) return res.status(400).json({ error: 'Verify your email again before submitting this application.' });
    const storage = req.app.get('storage') as StorageInterface;
    if (!storage.storageConfigured()) return res.status(503).json({ error: 'Private document storage is not configured. Contact the institution administrator.' });
    const applicationId = crypto.randomUUID();
    const keys: Record<(typeof kinds)[number], string> = {
      governmentIdDocument: `organizations/${organization.id}/staff-applications/${applicationId}/government-id`,
      institutionIdDocument: `organizations/${organization.id}/staff-applications/${applicationId}/institution-id`,
      authorizationDocument: `organizations/${organization.id}/staff-applications/${applicationId}/authorization-letter`,
    };
    await Promise.all(kinds.map((kind, index) => storage.putPrivateDocument(keys[kind], documents[index]!.buffer, documents[index]!.mimetype)));
    const passwordHash = await bcrypt.hash(data.password, 12);
    const result = await prisma.$transaction(async tx => {
      const now = new Date();
      const consumed = await tx.signupEmailChallenge.updateMany({
        where: { email: data.email, purpose: 'coordinator', organizationId: organization.id, verificationTokenHash: signupHash(data.verificationTicket), verifiedAt: { not: null }, expiresAt: { gt: now }, consumedAt: null },
        data: { consumedAt: now },
      });
      if (!consumed.count) return null;
      const user = await tx.user.create({ data: { name: data.name, email: data.email, passwordHash, memberships: { create: { organizationId: organization.id, role: 'teacher', active: false } } } });
      const request = await tx.staffVerificationRequest.create({ data: { organizationId: organization.id, userId: user.id, governmentIdDocument: keys.governmentIdDocument, institutionIdDocument: keys.institutionIdDocument, authorizationDocument: keys.authorizationDocument, status: 'submitted' } });
      return { user, request };
    });
    if (!result) return res.status(400).json({ error: 'Verify your email again before submitting this application.' });
    await audit(organization.id, result.user.id, 'staff_verification.submitted', 'StaffVerificationRequest', result.request.id);
    res.status(201).json({ status: result.request.status, organization: organization.name, message: 'Application submitted. Your coordinator access remains locked until the institution administrator reviews your proof.' });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return res.status(409).json({ error: 'This email already has an ExamGuard account.' });
    next(error);
  } });
  app.post('/api/public/institution-requests', directoryLimiter, (_req, res) => res.status(410).json({ error: 'Submit an institution application with identity documents and an administrator account.' }));
  app.post('/api/public/institution-applications', directoryLimiter, upload.fields([
    { name: 'governmentIdDocument', maxCount: 1 },
    { name: 'institutionIdDocument', maxCount: 1 },
    { name: 'authorizationLetterDocument', maxCount: 1 },
  ]), async (req, res, next) => { try {
    const data = z.object({
      contactName: z.string().trim().min(2).max(120),
      name: z.string().trim().min(2).max(200),
      countryCode: z.string().regex(/^[A-Za-z]{2}$/),
      region: z.string().trim().max(120).optional(),
      website: z.string().url().optional().or(z.literal('')),
      details: z.string().trim().max(2000).optional(),
      requesterEmail: z.string().email().transform(value => value.toLowerCase()),
      password: z.string().min(10),
      verificationTicket: z.string().min(40).max(100),
    }).parse(req.body);
    if (!passwordPolicy(data.password)) return res.status(400).json({ error: 'Password must contain upper and lower case letters, a number, and be at least 10 characters.' });
    const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
    const documentFields = [
      ['governmentIdDocument', files.governmentIdDocument?.[0]],
      ['institutionIdDocument', files.institutionIdDocument?.[0]],
      ['authorizationLetterDocument', files.authorizationLetterDocument?.[0]],
    ] as const;
    if (documentFields.some(([, file]) => !file)) return res.status(400).json({ error: 'Government ID, institution ID, and authorization letter are required.' });
    for (const [, file] of documentFields) {
      if (!file || !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.mimetype)) {
        return res.status(415).json({ error: 'Proof files must be JPEG, PNG, WebP, or PDF.' });
      }
      const valid = file.mimetype === 'application/pdf'
        ? isSupportedIdentityDocument(file.mimetype, file.buffer)
        : isSupportedImage(file.mimetype, file.buffer);
      if (!valid) return res.status(422).json({ error: 'A proof file does not match its declared file type.' });
    }
    const existing = await prisma.user.findUnique({ where: { email: data.requesterEmail }, select: { id: true } });
    if (existing) return res.status(409).json({ error: 'This email already has an ExamGuard account. Sign in or use a different institutional contact email.' });
    const validTicket = await prisma.signupEmailChallenge.findFirst({ where: { email: data.requesterEmail, purpose: 'institution_admin', organizationId: null, verificationTokenHash: signupHash(data.verificationTicket), verifiedAt: { not: null }, expiresAt: { gt: new Date() }, consumedAt: null } });
    if (!validTicket) return res.status(400).json({ error: 'Verify your email again before submitting this application.' });
    const requestId = crypto.randomUUID();
    const storage = req.app.get('storage') as StorageInterface;
    if (!storage.storageConfigured()) return res.status(503).json({ error: 'Private document storage is not configured. Contact the system administrator.' });
    const keys: Record<string, string> = {};
    for (const [field, file] of documentFields) {
      if (!file) continue;
      const key = `organizations/institution-applications/${requestId}/${field}-${crypto.randomUUID()}`;
      await storage.putPrivateDocument(key, file.buffer, file.mimetype);
      keys[field] = key;
    }
    const submitted = await prisma.$transaction(async tx => {
      const now = new Date();
      const consumed = await tx.signupEmailChallenge.updateMany({
        where: { email: data.requesterEmail, purpose: 'institution_admin', organizationId: null, verificationTokenHash: signupHash(data.verificationTicket), verifiedAt: { not: null }, expiresAt: { gt: now }, consumedAt: null },
        data: { consumedAt: now },
      });
      if (!consumed.count) return false;
      await tx.user.create({
        data: { name: data.contactName, email: data.requesterEmail, passwordHash: await bcrypt.hash(data.password, 12) },
      });
      await tx.institutionRequest.create({
        data: {
          id: requestId,
          name: data.name,
          countryCode: data.countryCode.toUpperCase(),
          region: data.region || null,
          website: data.website || null,
          details: data.details || null,
          requesterEmail: data.requesterEmail,
          governmentIdDocument: keys.governmentIdDocument,
          institutionIdDocument: keys.institutionIdDocument,
          authorizationLetterDocument: keys.authorizationLetterDocument,
        },
      });
      return true;
    });
    if (!submitted) return res.status(400).json({ error: 'Verify your email again before submitting this application.' });
    res.status(201).json({ status: 'submitted', message: 'Your institution application is awaiting system-administrator review.' });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return res.status(409).json({ error: 'This email or institution application is already registered.' });
    next(error);
  } });
  app.get('/api/platform/overview', authenticate, authorizePlatformAdmin, async (req: AuthRequest, res, next) => { try {
    const filters = z.object({ days: z.coerce.number().int().min(7).max(90).default(30) }).parse(req.query);
    const snapshotStartedAt = performance.now();
    const activityStart = new Date();
    activityStart.setUTCHours(0, 0, 0, 0);
    activityStart.setUTCDate(activityStart.getUTCDate() - (filters.days - 1));
    const previousStart = new Date(activityStart);
    previousStart.setUTCDate(previousStart.getUTCDate() - filters.days);
    const rangeEnd = new Date();
    const [organizationCount, activeOrganizationCount, userCount, memberships, exams, attempts, institutionRequests, staffVerifications, activityRows, registrationRows, participationRows, examCreationRows, scoreSummary, scoreBuckets, recentAudit, detectionRows, incidentGroups, incidentTrendRows, evidenceSummary, evidenceKinds, emailOutbox, activeExamCount, liveExamDetails, comparisons] = await Promise.all([
      prisma.organization.count({ where: { slug: { not: 'examguard-system' } } }),
      prisma.organization.count({ where: { slug: { not: 'examguard-system' }, status: 'active' } }),
      prisma.user.count(),
      prisma.membership.groupBy({ by: ['role', 'active'], _count: { _all: true } }),
      prisma.exam.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.examAttempt.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.institutionRequest.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.staffVerificationRequest.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.$queryRaw<Array<{ day: string; count: number }>>`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
               COUNT(*)::int AS count
        FROM "audit_logs"
        WHERE "createdAt" >= ${activityStart}
        GROUP BY 1
        ORDER BY 1
      `,
      prisma.$queryRaw<Array<{ day: string; count: number }>>`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
               COUNT(*)::int AS count
        FROM "users"
        WHERE "createdAt" >= ${activityStart}
        GROUP BY 1
        ORDER BY 1
      `,
      prisma.$queryRaw<Array<{ day: string; count: number }>>`
        SELECT to_char(date_trunc('day', "startedAt"), 'YYYY-MM-DD') AS day,
               COUNT(*)::int AS count
        FROM "exam_attempts"
        WHERE "startedAt" >= ${activityStart}
        GROUP BY 1
        ORDER BY 1
      `,
      prisma.$queryRaw<Array<{ day: string; count: number }>>`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
               COUNT(*)::int AS count
        FROM "exams"
        WHERE "createdAt" >= ${activityStart}
        GROUP BY 1
        ORDER BY 1
      `,
      prisma.$queryRaw<Array<{ averagePercent: number | null; count: number }>>`
        SELECT AVG(("totalMarks" / NULLIF("maxMarks", 0)) * 100)::float8 AS "averagePercent",
               COUNT(*)::int AS count
        FROM "grades"
        WHERE "status" = 'published' AND "maxMarks" > 0
      `,
      prisma.$queryRaw<Array<{ bucket: number; count: number }>>`
        SELECT LEAST(FLOOR(("totalMarks" / NULLIF("maxMarks", 0)) * 10), 10)::int AS bucket,
               COUNT(*)::int AS count
        FROM "grades"
        WHERE "status" = 'published' AND "maxMarks" > 0
        GROUP BY 1
        ORDER BY 1
      `,
      prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, action: true, targetType: true, createdAt: true, actor: { select: { name: true } } },
      }),
      prisma.$queryRaw<Array<{ day: string; type: string; source: string; count: number }>>`
        SELECT to_char(date_trunc('day', "occurredAt"), 'YYYY-MM-DD') AS day,
               type, source::text AS source, COUNT(*)::int AS count
        FROM "proctoring_events"
        WHERE "occurredAt" >= ${activityStart} AND type != 'ai_context_frame'
        GROUP BY 1, 2, 3
        ORDER BY 1, 2, 3
      `,
      prisma.incident.groupBy({ by: ['severity', 'status'], _count: { _all: true } }),
      prisma.$queryRaw<Array<{ day: string; severity: string; count: number }>>`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
               severity::text AS severity, COUNT(*)::int AS count
        FROM "incidents"
        WHERE "createdAt" >= ${activityStart}
        GROUP BY 1, 2
        ORDER BY 1, 2
      `,
      prisma.evidenceObject.aggregate({ _count: { _all: true }, _sum: { sizeBytes: true } }),
      prisma.evidenceObject.groupBy({ by: ['mimeType'], _count: { _all: true }, _sum: { sizeBytes: true }, orderBy: { _count: { id: 'desc' } } }),
      prisma.emailOutbox.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.exam.count({ where: { status: 'live' } }),
      prisma.exam.findMany({
        where: { status: 'live' },
        orderBy: { startsAt: 'asc' },
        take: 10,
        select: { id: true, title: true, startsAt: true, endsAt: true, organization: { select: { name: true } }, _count: { select: { attempts: true } } },
      }),
      prisma.$queryRaw<Array<{ currentRegistrations: number; previousRegistrations: number; currentParticipation: number; previousParticipation: number; currentExams: number; previousExams: number }>>`
        SELECT
          (SELECT COUNT(*)::int FROM "users" WHERE "createdAt" >= ${activityStart} AND "createdAt" < ${rangeEnd}) AS "currentRegistrations",
          (SELECT COUNT(*)::int FROM "users" WHERE "createdAt" >= ${previousStart} AND "createdAt" < ${activityStart}) AS "previousRegistrations",
          (SELECT COUNT(*)::int FROM "exam_attempts" WHERE "startedAt" >= ${activityStart} AND "startedAt" < ${rangeEnd}) AS "currentParticipation",
          (SELECT COUNT(*)::int FROM "exam_attempts" WHERE "startedAt" >= ${previousStart} AND "startedAt" < ${activityStart}) AS "previousParticipation",
          (SELECT COUNT(*)::int FROM "exams" WHERE "createdAt" >= ${activityStart} AND "createdAt" < ${rangeEnd}) AS "currentExams",
          (SELECT COUNT(*)::int FROM "exams" WHERE "createdAt" >= ${previousStart} AND "createdAt" < ${activityStart}) AS "previousExams"
      `,
    ]);
    const snapshotQueryMs = Math.round(performance.now() - snapshotStartedAt);
    const dailySeries = (rows: Array<{ day: string; count: number }>) => {
      const dayCounts = new Map(rows.map(row => [row.day, row.count]));
      return Array.from({ length: filters.days }, (_, index) => {
        const day = new Date(activityStart);
        day.setUTCDate(day.getUTCDate() + index);
        const key = day.toISOString().slice(0, 10);
        return { day: key, count: dayCounts.get(key) ?? 0 };
      });
    };
    const dailyGroupedSeries = (rows: Array<{ day: string; type?: string; severity?: string; source?: string; count: number }>, keyName: 'type' | 'severity' | 'source') => {
      const groups = [...new Set(rows.map(row => row[keyName]).filter((value): value is string => Boolean(value)))];
      return groups.map(key => ({
        key,
        series: dailySeries(rows.filter(row => row[keyName] === key)),
      }));
    };
    const membershipsByRole = Object.fromEntries(['platform_admin', 'institute_admin', 'teacher', 'proctor', 'student'].map(role => [
      role,
      memberships.filter(item => item.role === role).reduce((total, item) => total + item._count._all, 0),
    ]));
    const groupedCounts = <T extends { _count: { _all: number } }>(groups: T[], key: (group: T) => string) =>
      Object.fromEntries(groups.map(group => [key(group), group._count._all]));
    res.json({
      generatedAt: new Date().toISOString(),
      range: { days: filters.days, from: activityStart.toISOString().slice(0, 10) },
      comparisons: comparisons[0] ?? { currentRegistrations: 0, previousRegistrations: 0, currentParticipation: 0, previousParticipation: 0, currentExams: 0, previousExams: 0 },
      health: {
        api: 'operational',
        database: 'connected',
        storage: realStorage.storageConfigured() ? 'configured_not_verified' : 'unconfigured',
        aiService: process.env.AI_SERVICE_URL ? 'configured_not_verified' : 'unconfigured',
        email: emailProviderFromEnv() ? 'configured_not_verified' : 'unconfigured',
      },
      runtime: {
        uptimeSeconds: Math.floor(process.uptime()),
        snapshotQueryMs,
        memory: process.memoryUsage(),
      },
      organizations: { total: organizationCount, active: activeOrganizationCount },
      users: {
        total: userCount,
        memberships: memberships.reduce((total, item) => total + item._count._all, 0),
        activeMemberships: memberships.filter(item => item.active).reduce((total, item) => total + item._count._all, 0),
        inactiveMemberships: memberships.filter(item => !item.active).reduce((total, item) => total + item._count._all, 0),
        byRole: membershipsByRole,
      },
      exams: { total: exams.reduce((total, item) => total + item._count._all, 0), byStatus: groupedCounts(exams, item => item.status) },
      attempts: { total: attempts.reduce((total, item) => total + item._count._all, 0), byStatus: groupedCounts(attempts, item => item.status) },
      institutionRequests: groupedCounts(institutionRequests, item => item.status),
      staffVerifications: groupedCounts(staffVerifications, item => item.status),
      activity: dailySeries(activityRows),
      registrations: dailySeries(registrationRows),
      participation: dailySeries(participationRows),
      examCreations: dailySeries(examCreationRows),
      detections: {
        byType: Object.fromEntries([...new Set(detectionRows.map(row => row.type))].map(type => [type, detectionRows.filter(row => row.type === type).reduce((total, row) => total + row.count, 0)])),
        ai: dailyGroupedSeries(detectionRows.filter(row => row.source === 'ai_service'), 'type'),
        phone: dailySeries(detectionRows.filter(row => row.type === 'phone_detected')),
      },
      incidents: {
        bySeverity: Object.fromEntries(['low', 'medium', 'high', 'critical'].map(severity => [severity, incidentGroups.filter(row => row.severity === severity).reduce((total, row) => total + row._count._all, 0)])),
        byStatus: Object.fromEntries([...new Set(incidentGroups.map(row => row.status))].map(status => [status, incidentGroups.filter(row => row.status === status).reduce((total, row) => total + row._count._all, 0)])),
        trend: dailyGroupedSeries(incidentTrendRows, 'severity'),
      },
      evidence: {
        items: evidenceSummary._count._all,
        bytes: evidenceSummary._sum.sizeBytes ?? 0,
        byType: evidenceKinds.map(row => ({ type: row.mimeType, count: row._count._all, bytes: row._sum.sizeBytes ?? 0 })),
      },
      emailOutbox: Object.fromEntries(emailOutbox.map(row => [row.status, row._count._all])),
      activeExams: activeExamCount,
      liveExamDetails,
      performance: {
        publishedGrades: scoreSummary[0]?.count ?? 0,
        averagePercent: scoreSummary[0]?.averagePercent ?? null,
        distribution: Array.from({ length: 11 }, (_, bucket) => ({
          range: bucket === 10 ? '100%' : `${bucket * 10}-${bucket * 10 + 9}%`,
          count: scoreBuckets.find(item => item.bucket === bucket)?.count ?? 0,
        })),
      },
      recentAudit,
    });
  } catch (error) { next(error); } });
  app.get('/api/platform/members', authenticate, authorizePlatformAdmin, async (req: AuthRequest, res, next) => { try {
    const filters = z.object({
      page: z.coerce.number().int().min(1).max(10_000).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(25),
      search: z.string().trim().max(120).optional(),
      role: z.enum(['platform_admin', 'institute_admin', 'teacher', 'proctor', 'student']).optional(),
      status: z.enum(['active', 'inactive']).optional(),
    }).parse(req.query);
    const where: Prisma.MembershipWhereInput = {
      ...(filters.role ? { role: filters.role } : {}),
      ...(filters.status ? { active: filters.status === 'active' } : {}),
      ...(filters.search ? {
        OR: [
          { user: { is: { name: { contains: filters.search, mode: 'insensitive' } } } },
          { user: { is: { email: { contains: filters.search, mode: 'insensitive' } } } },
          { organization: { is: { name: { contains: filters.search, mode: 'insensitive' } } } },
        ],
      } : {}),
    };
    const [total, members] = await Promise.all([
      prisma.membership.count({ where }),
      prisma.membership.findMany({
        where,
        orderBy: [{ organization: { name: 'asc' } }, { user: { name: 'asc' } }, { userId: 'asc' }],
        skip: paginationOffset(filters.page, filters.pageSize),
        take: filters.pageSize,
        select: {
          userId: true, organizationId: true, role: true, active: true, createdAt: true,
          user: { select: { name: true, email: true, isPlatformAdmin: true } },
          organization: { select: { name: true } },
        },
      }),
    ]);
    res.set(paginationHeaders(filters.page, filters.pageSize, total));
    res.json(members.map(({ userId, organizationId, role, active, createdAt, user, organization }) => ({
      userId, organizationId, role, active, createdAt,
      isPlatformAdmin: user.isPlatformAdmin,
      name: user.name, email: user.email, organizationName: organization.name,
    })));
  } catch (error) { next(error); } });
  app.patch('/api/platform/members/:organizationId/:userId', authenticate, authorizePlatformAdmin, async (req: AuthRequest, res, next) => { try {
    const organizationId = String(req.params.organizationId);
    const userId = String(req.params.userId);
    if (!isUuid(organizationId) || !isUuid(userId)) return res.status(400).json({ error: 'Valid organization and user IDs are required.' });
    const data = z.object({
      role: z.enum(['institute_admin', 'teacher', 'proctor', 'student']),
      active: z.boolean(),
      reason: z.string().trim().min(3).max(1000),
    }).parse(req.body);
    const result = await prisma.$transaction(async tx => {
      const existing = await tx.membership.findUnique({
        where: { userId_organizationId: { userId, organizationId } },
        include: { user: { select: { isPlatformAdmin: true } } },
      });
      if (!existing) return { kind: 'not_found' as const };
      if (!memberCanBeManaged(req.auth!.userId, userId, existing.role, existing.user.isPlatformAdmin)) return { kind: 'forbidden' as const };
      const activeAdminCount = await tx.membership.count({ where: { organizationId, role: 'institute_admin', active: true } });
      if (wouldRemoveLastActiveAdmin(existing.role, existing.active, data.role, data.active, activeAdminCount)) return { kind: 'last_admin' as const };
      const membership = await tx.membership.update({
        where: { userId_organizationId: { userId, organizationId } },
        data: { role: data.role, active: data.active },
      });
      await tx.auditLog.create({
        data: {
          organizationId,
          actorId: req.auth!.userId,
          action: 'platform.member_updated',
          targetType: 'Membership',
          targetId: userId,
          metadata: { previousRole: existing.role, previousActive: existing.active, role: membership.role, active: membership.active, reason: data.reason },
        },
      });
      return { kind: 'ok' as const, membership };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (result.kind === 'not_found') return res.status(404).json({ error: 'Organization membership not found.' });
    if (result.kind === 'forbidden') return res.status(403).json({ error: 'System administrator memberships cannot be changed here, and administrators cannot edit their own membership.' });
    if (result.kind === 'last_admin') return res.status(409).json({ error: 'The institution must retain at least one active administrator.' });
    res.json({ userId: result.membership.userId, organizationId: result.membership.organizationId, role: result.membership.role, active: result.membership.active });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const known = prismaErrorResponse(error.code);
      if (known) return res.status(known.status).json({ error: known.message });
    }
    next(error);
  } });
  app.get('/api/platform/institution-requests', authenticate, authorizePlatformAdmin, async (_req: AuthRequest, res, next) => { try {
    const requests = await prisma.institutionRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    res.json(requests.map(request => ({ id: request.id, name: request.name, requesterEmail: request.requesterEmail, status: request.status, createdAt: request.createdAt, documents: { governmentId: Boolean(request.governmentIdDocument), institutionId: Boolean(request.institutionIdDocument), authorizationLetter: Boolean(request.authorizationLetterDocument) } })));
  } catch (error) { next(error); } });
  app.get('/api/platform/institution-requests/:id/documents/:kind', authenticate, authorizePlatformAdmin, async (req: AuthRequest, res, next) => { try {
    const kind = z.enum(['governmentIdDocument', 'institutionIdDocument', 'authorizationLetterDocument']).parse(req.params.kind);
    const request = await prisma.institutionRequest.findUnique({ where: { id: String(req.params.id) }, select: { [kind]: true } });
    const key = request?.[kind];
    if (!key) return res.status(404).json({ error: 'Proof document not found.' });
    const storage = req.app.get('storage') as StorageInterface;
    const url = await storage.privateDocumentUrl(key);
    await audit(req.auth!.organizationId!, req.auth!.userId, 'platform.institution_request.document_viewed', 'InstitutionRequest', String(req.params.id), { kind });
    res.json({ url });
  } catch (error) { next(error); } });
  app.post('/api/platform/institution-requests/:id/decision', authenticate, authorizePlatformAdmin, async (req: AuthRequest, res, next) => { try {
    const id = String(req.params.id);
    const data = z.object({ action: z.enum(['approve', 'reject', 'under_review']), reason: z.string().min(3).max(1000).optional() }).parse(req.body);
    const request = await prisma.institutionRequest.findUnique({ where: { id } });
    if (!request) return res.status(404).json({ error: 'Institution request not found' });
    if (data.action === 'approve' && (!request.governmentIdDocument || !request.institutionIdDocument || !request.authorizationLetterDocument)) {
      return res.status(409).json({ error: 'Government ID, institution ID, and authorization letter are required before approval.' });
    }
    const applicant = data.action === 'approve'
      ? await prisma.user.findUnique({ where: { email: request.requesterEmail }, select: { id: true } })
      : null;
    if (data.action === 'approve' && !applicant) return res.status(409).json({ error: 'The institution contact account is missing. Ask them to submit a new application.' });
    const updated = await prisma.$transaction(async tx => {
      if (data.action === 'approve') {
        const changed = await tx.institutionRequest.updateMany({
          where: { id, status: { in: ['submitted', 'under_review'] } },
          data: { status: 'approved', reviewerId: req.auth!.userId, reviewReason: data.reason ?? null },
        });
        if (!changed.count) return null;
        const organization = await tx.organization.create({
          data: {
            name: request.name,
            slug: `${request.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'institution'}-${crypto.randomUUID().slice(0, 8)}`,
          },
        });
        await tx.membership.create({ data: { userId: applicant!.id, organizationId: organization.id, role: 'institute_admin' } });
        await tx.auditLog.create({ data: { organizationId: req.auth!.organizationId!, actorId: req.auth!.userId, action: `platform.institution_request.${data.action}`, targetType: 'InstitutionRequest', targetId: id, metadata: { reason: data.reason ?? null } } });
        return { ...(await tx.institutionRequest.findUniqueOrThrow({ where: { id } })), organization };
      }
      const changed = await tx.institutionRequest.updateMany({
        where: { id, status: { in: ['submitted', 'under_review'] } },
        data: { status: data.action === 'reject' ? 'rejected' : 'under_review', reviewerId: req.auth!.userId, reviewReason: data.reason ?? null },
      });
      if (!changed.count) return null;
      const reviewed = await tx.institutionRequest.findUnique({ where: { id } });
      await tx.auditLog.create({ data: { organizationId: req.auth!.organizationId!, actorId: req.auth!.userId, action: `platform.institution_request.${data.action}`, targetType: 'InstitutionRequest', targetId: id, metadata: { reason: data.reason ?? null } } });
      return reviewed;
    });
    if (!updated) return res.status(409).json({ error: 'This institution application was already reviewed. Reload the queue.' });
    res.json(updated);
  } catch (error) { next(error); } });
  app.get('/api/platform/staff-verifications', authenticate, authorizePlatformAdmin, async (_req: AuthRequest, res, next) => { try {
    const requests = await prisma.staffVerificationRequest.findMany({ include: { organization: { select: { id: true, name: true } }, user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
    res.json(requests.map(request => ({ id: request.id, status: request.status, createdAt: request.createdAt, organization: request.organization, user: request.user, documents: { governmentId: Boolean(request.governmentIdDocument), institutionId: Boolean(request.institutionIdDocument), authorizationLetter: Boolean(request.authorizationDocument) } })));
  } catch (error) { next(error); } });
  app.get('/api/platform/staff-verifications/:id/documents/:kind', authenticate, authorizePlatformAdmin, async (req: AuthRequest, res, next) => { try {
    const kind = z.enum(['governmentIdDocument', 'institutionIdDocument', 'authorizationDocument']).parse(req.params.kind);
    const request = await prisma.staffVerificationRequest.findUnique({ where: { id: String(req.params.id) }, select: { [kind]: true } });
    const key = request?.[kind];
    if (!key) return res.status(404).json({ error: 'Proof document not found.' });
    const storage = req.app.get('storage') as StorageInterface;
    const url = await storage.privateDocumentUrl(key);
    await audit(req.auth!.organizationId!, req.auth!.userId, 'platform.staff_verification.document_viewed', 'StaffVerificationRequest', String(req.params.id), { kind });
    res.json({ url });
  } catch (error) { next(error); } });
  app.post('/api/platform/staff-verifications/:id/decision', authenticate, authorizePlatformAdmin, async (req: AuthRequest, res, next) => { try {
    const id = String(req.params.id);
    const data = z.object({ action: z.enum(['approve', 'reject', 'request_more_information']), reason: z.string().min(3).max(1000).optional() }).parse(req.body);
    const request = await prisma.staffVerificationRequest.findUnique({ where: { id } });
    if (!request) return res.status(404).json({ error: 'Staff verification request not found' });
    if (data.action === 'approve' && (!request.governmentIdDocument || !request.institutionIdDocument || !request.authorizationDocument)) return res.status(409).json({ error: 'All required identity documents must be present before approval.' });
    const updated = await prisma.$transaction(async tx => {
      const changed = await tx.staffVerificationRequest.updateMany({
        where: { id, status: { in: ['submitted', 'resubmission_required'] } },
        data: { status: data.action === 'approve' ? 'approved' : data.action === 'reject' ? 'rejected' : 'resubmission_required', reviewReason: data.reason ?? null, reviewedAt: new Date(), reviewedById: req.auth!.userId },
      });
      if (!changed.count) return null;
      const reviewed = await tx.staffVerificationRequest.findUniqueOrThrow({ where: { id } });
      await tx.auditLog.create({ data: { organizationId: request.organizationId, actorId: req.auth!.userId, action: `platform.staff_verification.${data.action}`, targetType: 'StaffVerificationRequest', targetId: id, metadata: { reason: data.reason ?? null } } });
      return reviewed;
    });
    if (!updated) return res.status(409).json({ error: 'This staff verification was already reviewed. Reload the queue.' });
    res.json(updated);
  } catch (error) { next(error); } });
  app.post('/api/organizations/:organizationId/staff-verifications', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
    const data = z.object({ userId: z.string().uuid().optional(), governmentIdDocument: z.string().max(512).optional(), institutionIdDocument: z.string().max(512).optional(), authorizationDocument: z.string().max(512).optional() }).parse(req.body);
    const organizationId = req.auth!.organizationId!;
    const userId = data.userId ?? req.auth!.userId;
    const membership = await prisma.membership.findFirst({ where: { organizationId, userId, active: true, role: { in: ['teacher', 'proctor'] } } });
    if (!membership) return res.status(404).json({ error: 'Active coordinator or proctor membership not found' });
    if (userId !== req.auth!.userId && req.auth!.role !== 'institute_admin') return res.status(403).json({ error: 'Only an institute administrator can submit verification for another staff member' });
    const request = await prisma.staffVerificationRequest.upsert({ where: { organizationId_userId: { organizationId, userId } }, update: { ...data, userId, status: 'submitted', reviewReason: null }, create: { organizationId, userId, ...data, status: 'submitted' } });
    await audit(organizationId, req.auth!.userId, 'staff_verification.submitted', 'StaffVerificationRequest', request.id);
    res.status(201).json(request);
  } catch (error) { next(error); } });
  app.get('/api/organizations/:organizationId/staff-applications', authenticate, authorize('institute_admin'), async (req: AuthRequest, res, next) => { try {
    const requests = await prisma.staffVerificationRequest.findMany({ where: { organizationId: req.auth!.organizationId!, status: { in: ['submitted', 'resubmission_required'] } }, include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: 'asc' } });
    res.json(requests.map(request => ({ id: request.id, status: request.status, createdAt: request.createdAt, reviewReason: request.reviewReason, user: request.user, documents: { governmentId: Boolean(request.governmentIdDocument), institutionId: Boolean(request.institutionIdDocument), authorizationLetter: Boolean(request.authorizationDocument) } })));
  } catch (error) { next(error); } });
  app.post('/api/organizations/:organizationId/staff-applications/:id/decision', authenticate, authorize('institute_admin'), async (req: AuthRequest, res, next) => { try {
    const data = z.object({ action: z.enum(['approve', 'reject', 'request_more_information']), reason: z.string().trim().min(3).max(1000).optional() }).parse(req.body);
    if (data.action !== 'approve' && !data.reason) return res.status(400).json({ error: 'A reason is required for this decision.' });
    const organizationId = req.auth!.organizationId!;
    const id = String(req.params.id);
    const request = await prisma.staffVerificationRequest.findFirst({ where: { id, organizationId, status: { in: ['submitted', 'resubmission_required'] } } });
    if (!request) return res.status(404).json({ error: 'Coordinator application not found.' });
    if (data.action === 'approve' && (!request.governmentIdDocument || !request.institutionIdDocument || !request.authorizationDocument)) return res.status(409).json({ error: 'All three proof documents are required before approval.' });
    const status = data.action === 'approve' ? 'approved' : data.action === 'reject' ? 'rejected' : 'resubmission_required';
    const updated = await prisma.$transaction(async tx => {
      const changed = await tx.staffVerificationRequest.updateMany({ where: { id, organizationId, status: { in: ['submitted', 'resubmission_required'] } }, data: { status, reviewReason: data.reason ?? null, reviewedAt: new Date(), reviewedById: req.auth!.userId } });
      if (!changed.count) return null;
      await tx.membership.update({ where: { userId_organizationId: { userId: request.userId, organizationId } }, data: { active: data.action === 'approve' } });
      return tx.staffVerificationRequest.findUnique({ where: { id } });
    });
    if (!updated) return res.status(409).json({ error: 'This application was already reviewed. Reload the queue.' });
    await audit(organizationId, req.auth!.userId, `staff_application.${data.action}`, 'StaffVerificationRequest', id, { reason: data.reason });
    await notify(organizationId, request.userId, `staff_application_${data.action}`, data.action === 'approve' ? 'Coordinator access approved' : data.action === 'reject' ? 'Coordinator application declined' : 'More information required', data.action === 'approve' ? 'Your coordinator access is active. You can now sign in.' : data.reason ?? 'Please contact your institution administrator.');
    res.json(updated);
  } catch (error) { next(error); } });
  app.get('/api/organizations/:organizationId/staff-applications/:id/documents/:kind', authenticate, authorize('institute_admin'), async (req: AuthRequest, res, next) => { try {
    const kind = z.enum(['governmentIdDocument', 'institutionIdDocument', 'authorizationDocument']).parse(req.params.kind);
    const request = await prisma.staffVerificationRequest.findFirst({ where: { id: String(req.params.id), organizationId: req.auth!.organizationId! }, select: { [kind]: true } });
    const key = request?.[kind];
    if (!key) return res.status(404).json({ error: 'Proof document not found.' });
    const storage = req.app.get('storage') as StorageInterface;
    res.json({ url: await storage.privateDocumentUrl(key) });
  } catch (error) { next(error); } });
  app.post('/api/auth/register', (_req, res) => res.status(410).json({ error: 'Direct institution registration is disabled. Submit an institution identity application for system-administrator approval.' }));
  app.post('/api/auth/login', async (req, res, next) => { try {
    const data = credentials.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user || !(await bcrypt.compare(data.password, user.passwordHash))) return res.status(401).json({ error: 'Invalid email or password' });
    const membership = await prisma.membership.findFirst({ where: { userId: user.id, active: true }, include: { organization: true }, orderBy: { createdAt: 'asc' } });
    if (!membership) {
      const application = await prisma.staffVerificationRequest.findFirst({ where: { userId: user.id, status: { in: ['submitted', 'resubmission_required'] } }, include: { organization: { select: { name: true } } } });
      if (application) return res.status(403).json({ error: `Your coordinator application for ${application.organization.name} is awaiting university review.` });
      const institutionApplication = await prisma.institutionRequest.findFirst({ where: { requesterEmail: user.email }, orderBy: { createdAt: 'desc' }, select: { name: true, status: true, reviewReason: true } });
      if (institutionApplication?.status === 'submitted' || institutionApplication?.status === 'under_review') {
        return res.status(403).json({ error: `Your application for ${institutionApplication.name} is awaiting system-administrator review.` });
      }
      if (institutionApplication?.status === 'rejected') {
        return res.status(403).json({ error: `Your institution application was not approved${institutionApplication.reviewReason ? `: ${institutionApplication.reviewReason}` : '.'}` });
      }
      const candidate = await prisma.candidate.findFirst({ where: { userId: user.id }, include: { verificationRequests: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, rejectionReason: true } } } });
      const verification = candidate?.verificationRequests[0];
      if (candidate && verification?.status !== 'approved') {
        return res.status(403).json({ error: verification?.status === 'rejected'
          ? `Your student application was not approved${verification.rejectionReason ? `: ${verification.rejectionReason}` : '.'}`
          : 'Your student application is awaiting approval by your institution.' });
      }
      return res.status(403).json({ error: 'No active organization membership' });
    }
    res.json({ token: signToken(user.id, user.updatedAt.getTime()), user: { id: user.id, name: user.name, email: user.email }, organization: { id: membership.organization.id, name: membership.organization.name }, role: membership.role });
  } catch (error) { next(error); } });
  app.get('/api/organizations/:organizationId/teacher-profile', authenticate, authorize('teacher'), async (req: AuthRequest, res, next) => { try {
    const membership = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId: req.auth!.userId, organizationId: req.auth!.organizationId! } },
      select: { subjects: true },
    });
    if (!membership) return res.status(404).json({ error: 'Teacher profile not found.' });
    res.json({ subjects: membership.subjects });
  } catch (error) { next(error); } });
  app.patch('/api/organizations/:organizationId/teacher-profile', authenticate, authorize('teacher'), async (req: AuthRequest, res, next) => { try {
    const data = z.object({ subjects: z.array(z.string().trim().min(1).max(80)).max(20) }).parse(req.body);
    const subjects = [...new Map(data.subjects.map(subject => [subject.toLocaleLowerCase(), subject])).values()];
    const organizationId = req.auth!.organizationId!;
    const membership = await prisma.membership.update({
      where: { userId_organizationId: { userId: req.auth!.userId, organizationId } },
      data: { subjects },
      select: { subjects: true },
    });
    await audit(organizationId, req.auth!.userId, 'teacher_profile.subjects_updated', 'Membership', req.auth!.userId, { subjects });
    res.json({ subjects: membership.subjects });
  } catch (error) { next(error); } });
  app.post('/api/auth/password-reset/request', passwordResetLimiter, async (req, res, next) => { try {
    const { email } = resetRequest.parse(req.body);
    const generic = { message: 'If an account exists and email delivery is working, a verification code will be sent.' };
    if (!emailProviderFromEnv()) {
      console.error('email.request.failed', { operation: 'password_reset_otp', provider: 'unavailable', reason: 'not_configured' });
      return res.status(503).json({ error: 'Password reset email delivery is temporarily unavailable. Please try again later.' });
    }
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(202).json(generic);
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
    try { await sendPasswordOtpEmail(user.email, otp); } catch {
      await prisma.passwordResetToken.delete({ where: { id: reset.id } });
      return res.status(503).json({ error: 'Password reset email delivery failed. Please try again later.' });
    }
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
  const [exams, candidates, openIncidents, incidents, activeSessions, pendingExplanations, awaitingEvaluation, pendingManual, readyToPublish] = await Promise.all([
    prisma.exam.count({ where: { organizationId, isPractice: false } }),
    prisma.candidate.count({ where: { organizationId } }),
    prisma.incident.count({ where: { organizationId, status: 'open' } }),
    prisma.incident.findMany({ where: { organizationId, status: 'open' }, orderBy: { createdAt: 'desc' }, take: 5 }),
    prisma.examAttempt.count({ where: { organizationId, status: 'in_progress' } }),
    prisma.studentExplanation.count({ where: { organizationId, status: { in: ['requested', 'follow_up'] } } }),
    prisma.examAttempt.count({ where: { organizationId, exam: { isPractice: false }, status: { in: ['submitted', 'expired'] }, grade: { is: null } } }),
    prisma.grade.count({ where: { organizationId, exam: { isPractice: false }, status: 'pending_manual' } }),
    prisma.grade.count({ where: { organizationId, exam: { isPractice: false }, status: 'graded' } })
  ]);
  res.json({ stats: { exams, candidates, openIncidents, activeSessions, pendingExplanations, awaitingEvaluation, pendingManual, readyToPublish }, incidents });
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
app.get('/api/organizations/:organizationId/exam-templates', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
  const templates = await prisma.examTemplate.findMany({
    where: { organizationId: req.auth!.organizationId! },
    orderBy: [{ name: 'asc' }, { createdAt: 'desc' }],
    select: { id: true, name: true, description: true, createdAt: true },
  });
  res.json(templates);
} catch (error) { next(error); } });
app.get('/api/organizations/:organizationId/exam-templates/:templateId', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
  const template = await prisma.examTemplate.findFirst({
    where: { id: String(req.params.templateId), organizationId: req.auth!.organizationId! },
    select: { id: true, name: true, description: true, settings: true, questions: true },
  });
  if (!template) return res.status(404).json({ error: 'Exam template not found' });
  res.json(template);
} catch (error) { next(error); } });
app.post('/api/organizations/:organizationId/exam-templates', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
  const data = z.object({
    name: z.string().trim().min(2).max(160),
    description: z.string().trim().max(1000).optional(),
    sourceExamId: z.string().uuid(),
  }).parse(req.body);
  const organizationId = req.auth!.organizationId!;
  const exam = await prisma.exam.findFirst({ where: { id: data.sourceExamId, organizationId, status: 'draft' } });
  if (!exam) return res.status(404).json({ error: 'Only an editable draft exam can be saved as a template' });
  const questions = await prisma.question.findMany({
    where: { organizationId, examId: exam.id },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    include: { codingQuestion: { include: { testCases: { orderBy: { position: 'asc' } } } } },
  });
  if (!questions.length) return res.status(400).json({ error: 'Add and save at least one question before creating a template' });
  const questionSnapshot = questions.map(question => ({
    type: question.type,
    prompt: question.prompt,
    options: question.options ?? [],
    correctAnswer: question.correctAnswer,
    marks: question.marks,
    negativeMarks: question.negativeMarks,
    ...(question.codingQuestion ? {
      coding: {
        title: question.codingQuestion.title,
        description: question.codingQuestion.description,
        difficulty: question.codingQuestion.difficulty,
        mode: question.codingQuestion.mode,
        inputFormat: question.codingQuestion.inputFormat,
        outputFormat: question.codingQuestion.outputFormat,
        constraints: question.codingQuestion.constraints,
        explanation: question.codingQuestion.explanation,
        languageIds: question.codingQuestion.languageIds,
        starterCode: question.codingQuestion.starterCode,
        timeLimitMs: question.codingQuestion.timeLimitMs,
        memoryLimitKb: question.codingQuestion.memoryLimitKb,
        comparisonMode: question.codingQuestion.comparisonMode,
      },
      codingTestCases: question.codingQuestion.testCases.map(({ input, expectedOutput, visibility, position }) => ({ input, expectedOutput, visibility, position })),
    } : {}),
  }));
  const template = await prisma.examTemplate.create({
    data: {
      organizationId,
      createdById: req.auth!.userId,
      name: data.name,
      description: data.description,
      settings: {
        title: exam.title,
        instructions: exam.instructions,
        durationMinutes: exam.durationMinutes,
        isPractice: exam.isPractice,
        randomizeQuestions: exam.randomizeQuestions,
        randomizeOptions: exam.randomizeOptions,
        interventionPolicy: policyOf(exam),
      },
      questions: questionSnapshot as Prisma.InputJsonValue,
    },
    select: { id: true, name: true, description: true, createdAt: true },
  });
  await audit(organizationId, req.auth!.userId, 'exam_template.created', 'ExamTemplate', template.id, { sourceExamId: exam.id, questionCount: questionSnapshot.length });
  res.status(201).json(template);
} catch (error) { next(error); } });
app.delete('/api/organizations/:organizationId/exam-templates/:templateId', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
  const organizationId = req.auth!.organizationId!;
  const id = String(req.params.templateId);
  const deleted = await prisma.examTemplate.deleteMany({ where: { id, organizationId } });
  if (!deleted.count) return res.status(404).json({ error: 'Exam template not found' });
  await audit(organizationId, req.auth!.userId, 'exam_template.deleted', 'ExamTemplate', id);
  res.status(204).end();
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
    prisma.candidate.findMany({
      where,
      orderBy,
      skip: paginationOffset(filters.page, filters.pageSize),
      take: filters.pageSize,
      include: { verificationRequests: { where: { organizationId }, select: { status: true }, take: 1 } },
    })
  ]);
  res.set(paginationHeaders(filters.page, filters.pageSize, total));
  res.json(candidates.map(({ verificationRequests, ...candidate }) => ({
    ...candidate,
    verificationStatus: verificationRequests[0]?.status ?? 'not_submitted',
  })));
} catch (error) { next(error); } });
app.get('/api/organizations/:organizationId/candidates/:candidateId', authenticate, authorize('institute_admin', 'teacher', 'proctor'), async (req: AuthRequest, res, next) => { try {
  const organizationId = req.auth!.organizationId!;
  const candidate = await prisma.candidate.findFirst({ where: { id: String(req.params.candidateId), organizationId }, select: { id: true, name: true, email: true, phone: true, externalId: true, emailVerifiedAt: true, phoneVerifiedAt: true, userId: true } });
  if (!candidate) return res.status(404).json({ error: 'Candidate not found' });
  const [verification, assignments, attempts, grades] = await Promise.all([
    prisma.verificationRequest.findUnique({ where: { organizationId_candidateId: { organizationId, candidateId: candidate.id } }, select: { id: true, status: true, submittedAt: true, reviewedAt: true, rejectionReason: true, idDocument: true } }),
    prisma.examAssignment.findMany({ where: { organizationId, candidateId: candidate.id }, include: { exam: { select: { id: true, title: true, status: true, startsAt: true, endsAt: true, durationMinutes: true, isPractice: true } } } }),
    prisma.examAttempt.findMany({ where: { organizationId, candidateId: candidate.id }, select: { id: true, examId: true, status: true, startedAt: true, submittedAt: true, deadlineAt: true, receiptCode: true } }),
    prisma.grade.findMany({ where: { organizationId, candidateId: candidate.id, exam: { isPractice: false } }, select: { id: true, examId: true, totalMarks: true, maxMarks: true, status: true, publishedAt: true } })
  ]);
  res.json({
    candidate: { id: candidate.id, name: candidate.name, email: candidate.email, phone: candidate.phone, externalId: candidate.externalId, emailVerifiedAt: candidate.emailVerifiedAt, phoneVerifiedAt: candidate.phoneVerifiedAt, accountLinked: Boolean(candidate.userId) },
    verification: verification ? {
      id: verification.id,
      status: verification.status,
      submittedAt: verification.submittedAt,
      reviewedAt: verification.reviewedAt,
      rejectionReason: verification.rejectionReason,
      hasIdentityDocument: Boolean(verification.idDocument),
    } : { status: 'not_submitted' },
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
  const question = await prisma.question.create({ data: { ...questionFields(data), organizationId, examId, position: await prisma.question.count({ where: { examId } }), ...(data.coding ? { codingQuestion: { create: { organizationId, ...codingQuestionFields(data.coding), testCases: { create: data.codingTestCases.map(testCase => ({ organizationId, ...testCase })) } } } } : {}) }, include: { codingQuestion: { include: { testCases: true } } } });
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
  res.json(await prisma.question.findMany({ where: { organizationId: req.auth!.organizationId!, examId }, orderBy: { position: 'asc' }, include: { codingQuestion: { include: { testCases: true } } } }));
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
  res.json(await prisma.question.findMany({ where: { organizationId: req.auth!.organizationId!, bankId: String(req.params.bankId), examId: null }, orderBy: { createdAt: 'desc' }, include: { codingQuestion: { include: { testCases: true } } } }));
} catch (error) { next(error); } });
app.post('/api/organizations/:organizationId/question-banks/:bankId/questions', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
  const data = questionInput.parse(req.body);
  const organizationId = req.auth!.organizationId!;
  const bankId = String(req.params.bankId);
  const bank = await prisma.questionBank.findFirst({ where: { id: bankId, organizationId }, select: { id: true } });
  if (!bank) return res.status(404).json({ error: 'Question bank not found' });
  const question = await prisma.question.create({
    data: {
      ...questionFields(data),
      organizationId,
      bankId,
      ...(data.coding ? { codingQuestion: { create: { organizationId, ...codingQuestionFields(data.coding), testCases: { create: data.codingTestCases.map(testCase => ({ organizationId, ...testCase })) } } } } : {}),
    },
    include: { codingQuestion: { include: { testCases: true } } },
  });
  await audit(organizationId, req.auth!.userId, 'question_bank.question_created', 'Question', question.id);
  res.status(201).json(question);
} catch (error) { next(error); } });
app.put('/api/organizations/:organizationId/question-banks/:bankId/questions/:questionId', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
  const data = questionInput.parse(req.body);
  const organizationId = req.auth!.organizationId!;
  const questionId = String(req.params.questionId);
  const question = await prisma.$transaction(async tx => {
    const existing = await tx.question.findFirst({ where: { id: questionId, organizationId, bankId: String(req.params.bankId), examId: null }, select: { id: true } });
    if (!existing) return null;
    await tx.question.update({ where: { id: questionId }, data: questionFields(data, true) });
    if (data.coding) {
      await tx.codingQuestion.upsert({
        where: { questionId },
        create: { questionId, organizationId, ...codingQuestionFields(data.coding), testCases: { create: data.codingTestCases.map(testCase => ({ organizationId, ...testCase })) } },
        update: { ...codingQuestionFields(data.coding), testCases: { deleteMany: {}, create: data.codingTestCases.map(testCase => ({ organizationId, ...testCase })) } },
      });
    } else {
      await tx.codingQuestion.deleteMany({ where: { questionId } });
    }
    return tx.question.findUniqueOrThrow({ where: { id: questionId }, include: { codingQuestion: { include: { testCases: true } } } });
  });
  if (!question) return res.status(404).json({ error: 'Editable question-bank question not found' });
  await audit(organizationId, req.auth!.userId, 'question_bank.question_updated', 'Question', question.id);
  res.json(question);
} catch (error) { next(error); } });
app.post('/api/organizations/:organizationId/exams/:examId/questions/from-bank/:questionId', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
  const organizationId = req.auth!.organizationId!;
  const examId = String(req.params.examId);
  const [exam, source] = await Promise.all([
    prisma.exam.findFirst({ where: { id: examId, organizationId, status: 'draft' }, select: { id: true } }),
    prisma.question.findFirst({ where: { id: String(req.params.questionId), organizationId, bankId: { not: null }, examId: null }, include: { codingQuestion: { include: { testCases: true } } } })
  ]);
  if (!exam || !source) return res.status(404).json({ error: 'Draft exam or question-bank question not found' });
  const question = await prisma.question.create({
    data: {
      organizationId, examId, type: source.type, prompt: source.prompt,
      options: (source.options ?? undefined) as Prisma.InputJsonValue | undefined,
      correctAnswer: (source.correctAnswer ?? undefined) as Prisma.InputJsonValue | undefined,
      marks: source.marks, negativeMarks: source.negativeMarks,
      position: await prisma.question.count({ where: { examId } }),
      ...(source.codingQuestion ? { codingQuestion: { create: {
        organizationId,
        title: source.codingQuestion.title,
        description: source.codingQuestion.description,
        difficulty: source.codingQuestion.difficulty,
        mode: source.codingQuestion.mode,
        inputFormat: source.codingQuestion.inputFormat,
        outputFormat: source.codingQuestion.outputFormat,
        constraints: source.codingQuestion.constraints,
        explanation: source.codingQuestion.explanation,
        languageIds: source.codingQuestion.languageIds,
        starterCode: source.codingQuestion.starterCode as Prisma.InputJsonValue,
        timeLimitMs: source.codingQuestion.timeLimitMs,
        memoryLimitKb: source.codingQuestion.memoryLimitKb,
        comparisonMode: source.codingQuestion.comparisonMode,
        testCases: { create: source.codingQuestion.testCases.map(({ input, expectedOutput, visibility, position }) => ({ organizationId, input, expectedOutput, visibility, position })) },
      } } } : {}),
    },
    include: { codingQuestion: { include: { testCases: true } } },
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
  const [assignments, attempts, grades] = await Promise.all([
    prisma.examAssignment.findMany({ where: { organizationId, candidateId: candidate.id }, include: { exam: { select: { id: true, title: true, status: true, startsAt: true, endsAt: true, durationMinutes: true, instructions: true, isPractice: true, policyFullscreenRequired: true } } } }),
    prisma.examAttempt.findMany({ where: { organizationId, candidateId: candidate.id }, select: { id: true, examId: true, status: true, startedAt: true, submittedAt: true, deadlineAt: true, receiptCode: true } }),
    prisma.grade.findMany({ where: { organizationId, candidateId: candidate.id, status: 'published', exam: { isPractice: false } }, select: { id: true, examId: true, totalMarks: true, maxMarks: true, feedback: true, publishedAt: true } })
  ]);
  res.json({
    candidate: { id: candidate.id, name: candidate.name },
    assignments: assignments.map(assignment => ({ id: assignment.id, exam: assignment.exam, attempt: attempts.find(attempt => attempt.examId === assignment.examId), grade: grades.find(grade => grade.examId === assignment.examId) }))
  });
} catch (error) { next(error); } });
app.get('/api/organizations/:organizationId/student-applications', authenticate, authorize('institute_admin'), async (req: AuthRequest, res, next) => { try {
  const rows = await prisma.verificationRequest.findMany({
    where: { organizationId: req.auth!.organizationId!, status: { in: ['submitted', 'rejected'] } },
    select: { id: true, status: true, submittedAt: true, reviewedAt: true, rejectionReason: true, candidate: { select: { id: true, name: true, email: true, phone: true, userId: true } } },
  });
  const userIds = rows.map(row => row.candidate.userId).filter((userId): userId is string => Boolean(userId));
  const inactiveStudentMemberships = userIds.length ? await prisma.membership.findMany({
    where: { organizationId: req.auth!.organizationId!, userId: { in: userIds }, role: 'student', active: false },
    select: { userId: true },
  }) : [];
  const requiresAdminReview = new Set(inactiveStudentMemberships.map(membership => membership.userId));
  res.json(rows.map(({ candidate, ...row }) => ({
    ...row,
    candidateId: { id: candidate.id, name: candidate.name, email: candidate.email, phone: candidate.phone },
    requiresAdminReview: Boolean(candidate.userId && requiresAdminReview.has(candidate.userId)),
  })));
} catch (error) { next(error); } });
app.get('/api/organizations/:organizationId/student-applications/:id/documents/idDocument', authenticate, authorize('institute_admin'), async (req: AuthRequest, res, next) => { try {
  const organizationId = req.auth!.organizationId!;
  const verification = await prisma.verificationRequest.findFirst({
    where: { id: String(req.params.id), organizationId },
    select: { idDocument: true },
  });
  if (!verification?.idDocument) return res.status(404).json({ error: 'Student ID proof not found.' });
  const storage = req.app.get('storage') as StorageInterface;
  const url = await storage.privateDocumentUrl(verification.idDocument);
  await audit(organizationId, req.auth!.userId, 'student_application.document_viewed', 'VerificationRequest', String(req.params.id));
  res.json({ url });
} catch (error) { next(error); } });
app.post('/api/organizations/:organizationId/student-applications/:id/decision', authenticate, authorize('institute_admin'), async (req: AuthRequest, res, next) => { try {
  const data = z.object({ action: z.enum(['approve', 'reject']), reason: z.string().trim().min(3).max(1000).optional() }).parse(req.body);
  const action = data.action;
  if (action === 'reject' && !data.reason) return res.status(400).json({ error: 'A reason is required when rejecting an application.' });
  const organizationId = req.auth!.organizationId!;
  const id = String(req.params.id);
  const application = await prisma.verificationRequest.findFirst({
    where: { id, organizationId },
    include: { candidate: { select: { userId: true } } },
  });
  if (!application) return res.status(404).json({ error: 'Verification not found' });
  if (action === 'approve' && !application.idDocument) return res.status(409).json({ error: 'A government-issued ID document is required before approving this student application.' });
  const verification = await prisma.$transaction(async tx => {
    const reviewed = await tx.verificationRequest.updateMany({
      where: { id, organizationId, status: { in: ['submitted', 'resubmission_required'] } },
      data: { status: action === 'approve' ? 'approved' : 'rejected', rejectionReason: action === 'approve' ? null : data.reason, reviewedAt: new Date(), reviewedById: req.auth!.userId }
    });
    if (!reviewed.count) return null;
    const updated = await tx.verificationRequest.findUniqueOrThrow({ where: { id } });
    if (action === 'approve') {
      const candidate = await tx.candidate.findUnique({ where: { id: updated.candidateId }, select: { userId: true } });
      if (candidate?.userId) {
        await tx.membership.updateMany({
          where: { userId: candidate.userId, organizationId, role: 'student' },
          data: { active: true },
        });
      }
    }
    return updated;
  });
  if (!verification) return res.status(404).json({ error: 'Verification not found' });
  await audit(organizationId, req.auth!.userId, `student_application.${action}`, 'VerificationRequest', verification.id, { reason: data.reason });
  const candidate = await prisma.candidate.findUnique({ where: { id: verification.candidateId }, select: { userId: true } });
  if (candidate?.userId) await notify(organizationId, candidate.userId, `student_application_${action}`, action === 'approve' ? 'Student application approved' : 'Student application rejected', action === 'approve' ? 'Your institution approved your student application.' : `Your student application was rejected: ${data.reason}`);
  res.json(verification);
} catch (error) { next(error); } });
app.post('/api/student/organizations/:organizationId/exams/:examId/start', authenticate, async (req: AuthRequest, res, next) => { try {
  const organizationId = String(req.params.organizationId);
  const examId = String(req.params.examId);
  const startInput = z.object({ accessCode: z.string().optional(), monitoringConsentAccepted: z.literal(true), monitoringConsentVersion: z.literal('examguard-monitoring-v2') }).parse(req.body ?? {});
  const accessCode = startInput.accessCode;
  const candidate = await prisma.candidate.findFirst({ where: { organizationId, userId: req.auth!.userId } });
  const exam = await prisma.exam.findFirst({ where: { id: examId, organizationId, status: { in: ['published', 'scheduled', 'live'] } } });
  if (!candidate || !exam) return res.status(403).json({ error: 'Authorized candidate and published exam required' });
  const assignment = await prisma.examAssignment.findUnique({ where: { examId_candidateId: { examId: exam.id, candidateId: candidate.id } }, select: { id: true } });
  if (!assignment || !canStartExam(new Date(), exam.startsAt ?? undefined, exam.endsAt ?? undefined)) return res.status(403).json({ error: 'This exam is not currently available' });
  if (exam.accessCodeHash && !(accessCode && await bcrypt.compare(accessCode, exam.accessCodeHash))) return res.status(403).json({ error: 'Valid access code required' });
  const storage = req.app.get('storage') as StorageInterface;
  const [aiReadiness, evidenceStorageReadiness] = await Promise.all([checkAiService(), checkEvidenceStorage(storage)]);
  const readinessChecks = [aiReadiness.check, evidenceStorageReadiness];
  const readiness = readinessSummary(readinessChecks);
  if (!readiness.ready) {
    return res.status(503).json({
      error: 'Mandatory server-side examination readiness checks have not passed.',
      readiness: { ...readiness, checks: readinessChecks },
      capabilities: aiReadiness.capabilities,
    });
  }
  const attemptResult = await prisma.$transaction(async tx => {
    await tx.$queryRaw<Array<{ lock: string }>>`SELECT pg_advisory_xact_lock(hashtext(${req.auth!.userId})::bigint)::text AS lock`;
    const now = new Date();
    const anotherActiveAttempt = await tx.examAttempt.findFirst({
      where: {
        userId: req.auth!.userId,
        status: { in: ['in_progress', 'paused'] },
        deadlineAt: { gt: now },
        examId: { not: exam.id },
      },
      select: { id: true },
    });
    if (anotherActiveAttempt) return { kind: 'another_active_attempt' as const };

    const existing = await tx.examAttempt.findUnique({ where: { examId_candidateId: { examId: exam.id, candidateId: candidate.id } } });
    if (existing) return { kind: 'attempt' as const, attempt: existing, created: false };

    const questions = await tx.question.findMany({ where: { organizationId, examId: exam.id }, select: { id: true }, orderBy: { position: 'asc' } });
    const order = exam.randomizeQuestions ? shuffle(questions.map(q => q.id)) : questions.map(q => q.id);
    const startedAt = new Date();
    const created = await tx.examAttempt.create({
      data: {
        organizationId,
        examId: exam.id,
        candidateId: candidate.id,
        userId: req.auth!.userId,
        startedAt,
        deadlineAt: deadlineFor(startedAt, exam.durationMinutes, exam.endsAt ?? undefined),
        monitoringConsentAt: startedAt,
        monitoringConsentVersion: startInput.monitoringConsentVersion,
        questionOrder: order,
      },
    });
    return { kind: 'attempt' as const, attempt: created, created: true };
  });
  if (attemptResult.kind === 'another_active_attempt') {
    return res.status(409).json({ error: 'You already have an active examination. Resume or submit it before starting another.' });
  }
  let attempt = attemptResult.attempt;
  if (attemptResult.created) {
    await audit(organizationId, req.auth!.userId, 'attempt.started', 'ExamAttempt', attempt.id, { monitoringConsentVersion: startInput.monitoringConsentVersion });
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
  const rows = companionReady ? await prisma.question.findMany({
    where: { id: { in: attempt.questionOrder }, organizationId },
    include: { codingQuestion: { include: { testCases: { where: { visibility: 'sample' }, orderBy: { position: 'asc' } } } } },
  }) : [];
  const byId = new Map(rows.map(q => [q.id, q]));
  const questions = companionReady ? attempt.questionOrder.flatMap(id => {
    const q = byId.get(id);
    if (!q) return [];
    const options = Array.isArray(q.options) ? q.options : [];
    return [{
      id: q.id,
      type: q.type,
      prompt: q.prompt,
      options: exam.randomizeOptions ? shuffle(options) : options,
      marks: q.marks,
      ...(q.type === 'coding' && q.codingQuestion ? {
        coding: {
          title: q.codingQuestion.title,
          description: q.codingQuestion.description,
          difficulty: q.codingQuestion.difficulty,
          inputFormat: q.codingQuestion.inputFormat,
          outputFormat: q.codingQuestion.outputFormat,
          constraints: q.codingQuestion.constraints,
          languageIds: q.codingQuestion.languageIds,
          starterCode: q.codingQuestion.starterCode,
          samples: q.codingQuestion.testCases.map(({ id: sampleId, input, expectedOutput }) => ({
            id: sampleId,
            input,
            output: expectedOutput,
          })),
        },
      } : {}),
    }];
  }) : [];
  const answers = companionReady ? await prisma.attemptAnswer.findMany({ where: { attemptId: attempt.id } }) : [];
  res.json({ attempt: { id: attempt.id, organizationId: attempt.organizationId, candidateId: candidate.id, examId: exam.id, deadlineAt: attempt.deadlineAt, status: attempt.status }, exam: { title: exam.title, instructions: exam.instructions, isPractice: exam.isPractice, fullscreenRequired: exam.policyFullscreenRequired }, questions, answers, companionRequired: !companionReady });
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
app.get('/api/student/attempts/:attemptId/coding-executions', authenticate, async (req: AuthRequest, res, next) => { try {
  const attempt = await prisma.examAttempt.findFirst({ where: { id: String(req.params.attemptId), userId: req.auth!.userId }, select: { id: true } });
  if (!attempt) return res.status(404).json({ error: 'Attempt not found' });
  let available = false;
  let unavailableReason = 'The isolated code execution service is not configured.';
  if (codeRunner) {
    try {
      await codeRunner.checkReady();
      available = true;
      unavailableReason = '';
    } catch (error) {
      unavailableReason = 'Judge0 is configured but not reachable. Contact your exam organizer.';
      console.error('Judge0 readiness check failed', error instanceof Error ? error.message : String(error));
    }
  }
  const history = await prisma.codeSubmission.findMany({
    where: { attemptId: attempt.id, candidate: { userId: req.auth!.userId } },
    orderBy: { submittedAt: 'desc' },
    take: 20,
    select: { id: true, kind: true, status: true, submittedAt: true },
  });
  res.json({ available, unavailableReason: unavailableReason || undefined, languageIds: Object.keys(judge0LanguageIds), history: history.map(item => ({ id: item.id, kind: item.kind, status: item.status, createdAt: item.submittedAt })) });
} catch (error) { next(error); } });
const executeCoding = (kind: 'run' | 'submit'): express.RequestHandler => async (request, res, next) => { try {
  const req = request as AuthRequest;
  if (!codeRunner) return res.status(503).json({ error: 'The isolated code execution service is not configured.' });
  const data = codingExecutionRequest.parse(req.body);
  const attemptId = String(req.params.attemptId);
  const attempt = await prisma.examAttempt.findFirst({ where: { id: attemptId, userId: req.auth!.userId, status: 'in_progress', deadlineAt: { gt: new Date() } } });
  if (!attempt) return res.status(409).json({ error: 'An active authorized attempt is required.' });
  if (!attempt.monitoringConsentAt || attempt.monitoringConsentVersion !== 'examguard-monitoring-v2') return res.status(403).json({ error: 'Monitoring consent is not recorded for this attempt.' });
  const heartbeat = await prisma.radioObservation.findFirst({
    where: { organizationId: attempt.organizationId, attemptId, source: 'scanner_health', kind: 'heartbeat', scannerStatus: 'active', observedAt: { gt: new Date(Date.now() - 90_000) } },
    select: { id: true },
  });
  if (!heartbeat) return res.status(409).json({ error: 'The required Windows Companion is not reporting. Reconnect it to continue monitoring.' });
  const codingQuestion = await prisma.codingQuestion.findFirst({
    where: {
      organizationId: attempt.organizationId,
      questionId: data.questionId,
      question: { examId: attempt.examId, type: 'coding' },
      languageIds: { has: data.languageId },
    },
    include: { testCases: { where: { ...(kind === 'run' ? { visibility: 'sample' as const } : {}) }, orderBy: { position: 'asc' } } },
  });
  if (!codingQuestion) return res.status(404).json({ error: 'Coding question or requested language was not found for this attempt.' });
  const testCases = codingQuestion.testCases;
  if (!testCases.length) return res.status(409).json({ error: kind === 'run' ? 'This coding question has no visible sample cases.' : 'This coding question has no test cases.' });
  const runnerLanguageId = judge0LanguageIds[data.languageId];
  if (!runnerLanguageId) return res.status(400).json({ error: 'This programming language is not mapped to a Judge0 language.' });
  const submission = await prisma.codeSubmission.create({
    data: {
      organizationId: attempt.organizationId,
      attemptId: attempt.id,
      candidateId: attempt.candidateId,
      questionId: data.questionId,
      codingQuestionId: codingQuestion.id,
      languageId: data.languageId,
      sourceCode: data.sourceCode,
      kind,
      executionJob: { create: { organizationId: attempt.organizationId } },
    },
    include: { executionJob: { select: { id: true } } },
  });
  const executionJobId = submission.executionJob?.id;
  if (!executionJobId) throw new Error('Judge0 execution job was not created.');
  await audit(attempt.organizationId, req.auth!.userId, `coding.${kind}_queued`, 'CodeSubmission', submission.id, { questionId: data.questionId, languageId: data.languageId });
  try {
    const results = await executeCodingCases({
      runner: codeRunner,
      cases: testCases,
      languageId: runnerLanguageId,
      sourceCode: data.sourceCode,
      cpuTimeLimitSeconds: Math.max(1, Math.ceil(codingQuestion.timeLimitMs / 1000)),
      memoryLimitKb: codingQuestion.memoryLimitKb,
      comparisonMode: codingQuestion.comparisonMode,
      onToken: token => prisma.executionJob.update({ where: { id: executionJobId }, data: { runnerToken: token, status: 'running', startedAt: new Date() } }).then(() => undefined),
    });
    const status = aggregateExecutionStatus(results);
    await prisma.$transaction([
      prisma.executionResult.createMany({
        data: results.map(result => ({
          jobId: executionJobId,
          testCaseId: result.id,
          status: result.status,
          passed: result.passed,
          executionTimeMs: result.executionTimeMs,
          memoryKb: result.memoryKb,
          stdout: result.stdout,
          stderr: result.stderr,
          compileOutput: result.compileOutput,
          score: result.passed ? 1 : 0,
        })),
      }),
      prisma.executionJob.update({ where: { id: executionJobId }, data: { status, completedAt: new Date() } }),
      prisma.codeSubmission.update({ where: { id: submission.id }, data: { status, completedAt: new Date() } }),
    ]);
    const candidateResults = candidateExecutionResults(results);
    res.status(201).json({
      submissionId: submission.id,
      kind,
      status,
      createdAt: submission.submittedAt,
      ...candidateResults,
      message: kind === 'submit' ? 'Submission completed. Private test details are not returned.' : undefined,
    });
  } catch (error) {
    await prisma.$transaction([
      prisma.executionJob.update({ where: { id: executionJobId }, data: { status: 'runner_unavailable', completedAt: new Date() } }),
      prisma.codeSubmission.update({ where: { id: submission.id }, data: { status: 'runner_unavailable', completedAt: new Date() } }),
    ]);
    console.error('Judge0 execution failed', error instanceof Error ? error.message : String(error));
    res.status(503).json({ error: 'The isolated code execution service could not complete this request. Check the Judge0 service and retry.' });
  }
} catch (error) { next(error); } };
app.post('/api/student/attempts/:attemptId/coding-executions/run', authenticate, codingRunLimiter, executeCoding('run'));
app.post('/api/student/attempts/:attemptId/coding-executions/submit', authenticate, codingSubmitLimiter, executeCoding('submit'));
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
  const source = req.body?.source === 'screen' ? 'screen' : 'camera';
  await audit(attempt.organizationId, req.auth!.userId, `evidence.${source}_captured`, 'ExamAttempt', attempt.id, { evidenceKey: key, capturedAt: new Date().toISOString() });
  res.status(201).json({ evidenceKey: key });
} catch (error) { next(error); } });
app.post('/api/student/attempts/:attemptId/screen-capture', authenticate, upload.single('file'), validateFileContent, async (req: AuthRequest, res, next) => { try {
  const attempt = await prisma.examAttempt.findFirst({
    where: { id: String(req.params.attemptId), userId: req.auth!.userId, status: 'in_progress', deadlineAt: { gt: new Date() } },
  });
  if (!attempt || !req.file || !['image/jpeg', 'image/png', 'image/webp'].includes(req.file.mimetype)) {
    return res.status(403).json({ error: 'An active attempt and a valid full-display image are required.' });
  }
  if (!attempt.monitoringConsentAt || attempt.monitoringConsentVersion !== 'examguard-monitoring-v2') {
    return res.status(403).json({ error: 'Screen capture consent is not recorded for this attempt.' });
  }
  const capturedAt = z.string().datetime().safeParse(req.body?.capturedAt);
  if (!capturedAt.success || req.body?.displaySurface !== 'monitor') {
    return res.status(400).json({ error: 'A timestamp and verified full-display capture are required.' });
  }
  const storage = req.app.get('storage') as StorageInterface;
  if (!storage.storageConfigured()) return res.status(503).json({ error: 'Private evidence storage is not configured.' });
  const used = (await prisma.evidenceObject.aggregate({ where: { organizationId: attempt.organizationId }, _sum: { sizeBytes: true } }))._sum.sizeBytes ?? 0;
  const quota = evaluateQuota({ usedBytes: used, incomingBytes: req.file.size, quotaBytes: parseQuotaBytes(process.env.EVIDENCE_ORG_QUOTA_MB) });
  if (!quota.allowed) return res.status(507).json({ error: 'Private evidence storage is full; this screen image was not recorded.' });
  const evidenceKey = `organizations/${attempt.organizationId}/attempts/${attempt.id}/evidence/${crypto.randomUUID()}`;
  await storage.putPrivateDocument(evidenceKey, req.file.buffer, req.file.mimetype);
  await prisma.evidenceObject.create({
    data: { organizationId: attempt.organizationId, attemptId: attempt.id, objectKey: evidenceKey, sizeBytes: req.file.size, mimeType: req.file.mimetype },
  });
  const event = await prisma.proctoringEvent.create({
    data: {
      organizationId: attempt.organizationId,
      examId: attempt.examId,
      candidateId: attempt.candidateId,
      attemptId: attempt.id,
      type: 'screen_capture',
      occurredAt: new Date(capturedAt.data),
      source: 'browser',
      evidenceKey,
      fingerprint: crypto.randomUUID(),
      policyAction: 'recorded',
      details: {
        captureMode: 'periodic_full_display_still',
        displaySurface: 'monitor',
        reviewOnly: true,
        disclosure: 'Consent-based still image; not continuous video and not proof of misconduct.',
      },
    },
  });
  await audit(attempt.organizationId, req.auth!.userId, 'evidence.screen_capture_recorded', 'ProctoringEvent', event.id, { capturedAt: capturedAt.data });
  res.status(201).json({ evidenceKey, eventId: event.id });
} catch (error) { next(error); } });
app.post('/api/student/attempts/:attemptId/ai-frame', authenticate, aiFrameLimiter, upload.single('frame'), validateFileContent, async (req: AuthRequest, res, next) => { try {
  const attemptId = String(req.params.attemptId);
  const frameReceivedAt = new Date();
  const attempt = await prisma.examAttempt.findFirst({ where: { id: attemptId, userId: req.auth!.userId, status: 'in_progress', deadlineAt: { gt: new Date() } } });
  if (!attempt) return res.status(409).json({ error: 'An active authorized attempt is required' });
  if (!attempt.monitoringConsentAt || attempt.monitoringConsentVersion !== 'examguard-monitoring-v2') return res.status(403).json({ error: 'Monitoring consent is not recorded for this attempt' });
  if (!req.file || !['image/jpeg', 'image/png', 'image/webp'].includes(req.file.mimetype)) return res.status(415).json({ error: 'A JPEG, PNG, or WebP camera frame is required' });
  const serviceUrl = process.env.AI_SERVICE_URL;
  const serviceToken = process.env.AI_SERVICE_TOKEN;
  if (!serviceUrl || !serviceToken || serviceToken.length < 32) return res.status(503).json({ error: 'The AI service is not securely configured. Set AI_SERVICE_URL and the same 32-character AI_SERVICE_TOKEN on the API and AI service.' });
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
    return res.status(503).json({ error: 'The AI service did not respond. Check its health and the private API-to-AI network connection.' });
  }
  if (!inferenceResponse.ok) return res.status(503).json({ error: `The AI service returned HTTP ${inferenceResponse.status}.` });
  let analysis: z.infer<typeof aiFrameSchema>;
  try { analysis = aiFrameSchema.parse(await inferenceResponse.json()); }
  catch { return res.status(502).json({ error: 'The AI service returned an invalid analysis response.' }); }
  const activeAttemptAfterInference = await prisma.examAttempt.findFirst({
    where: {
      id: attempt.id,
      organizationId: attempt.organizationId,
      examId: attempt.examId,
      candidateId: attempt.candidateId,
      userId: req.auth!.userId,
      status: 'in_progress',
      deadlineAt: { gt: new Date() },
      monitoringConsentAt: { not: null },
      monitoringConsentVersion: 'examguard-monitoring-v2',
    },
    select: { id: true },
  });
  if (!activeAttemptAfterInference) return res.status(409).json({ error: 'The attempt closed before AI analysis could be recorded.' });
  const visuallyReadable = analysis.readability_assessment?.status === 'potentially_readable';
  const nearbyRadioResult = visuallyReadable ? await withAdvertisedNameCompatibility(includeAdvertisedName =>
    prisma.radioObservation.findMany({
    where: {
      organizationId: attempt.organizationId,
      attemptId: attempt.id,
      source: { in: ['bluetooth_le', 'wifi'] },
      kind: { in: ['advertisement', 'access_point'] },
      scannerStatus: 'active',
      rssi: { not: null },
      observedAt: { gte: new Date(frameReceivedAt.getTime() - 45_000), lte: frameReceivedAt },
    },
    orderBy: { observedAt: 'desc' },
    take: 20,
    select: { ...radioObservationSelect(includeAdvertisedName), source: true, kind: true, rssi: true, pseudonym: true, observedAt: true },
  })) : undefined;
  const nearbyRadioRows = nearbyRadioResult?.result ?? [];
  const proximityContext = nearbyRadioRows.flatMap(observation => {
    if ((observation.source !== 'bluetooth_le' && observation.source !== 'wifi') ||
        (observation.kind !== 'advertisement' && observation.kind !== 'access_point')) return [];
    return [{
      source: observation.source,
      kind: observation.kind,
      rssi: observation.rssi,
      pseudonym: observation.pseudonym,
      advertisedName: observation.advertisedName,
      advertisedNameAvailable: nearbyRadioResult?.advertisedNameAvailable ?? false,
      observedAt: observation.observedAt.toISOString(),
      proximity: radioProximity(observation.source, observation.rssi),
      association: 'temporal_only_device_not_linked' as const,
    }];
  });
  const proximitySupported = proximityContext.some(observation =>
    supportsPotentialVisualAssistance(observation.source, observation.kind, observation.proximity.band),
  );
  analysis.proximity_context = proximityContext;
  if (nearbyRadioResult) analysis.advertised_name_storage_available = nearbyRadioResult.advertisedNameAvailable;
  analysis.potential_visual_assistance = {
    flagged: visuallyReadable && proximitySupported,
    confidence: 'low',
    rationale: visuallyReadable && proximitySupported
      ? 'A screen was estimated as potentially readable and a near/medium BLE advertisement was recorded in the same attempt within 45 seconds. No evidence links that advertisement to the visible screen.'
      : 'A Potential Visual Assistance flag requires both a potentially readable visible screen and a recent near/medium BLE advertisement; no device identity is inferred.',
  };
  const qualified = aiSignalsForFrame(attempt.id, {
    face_missing: !analysis.face_presence,
    multiple_faces: analysis.multiple_faces,
    looking_away: analysis.looking_away === 'looking_away',
    phone_detected: analysis.phone_detection === 'detected',
    camera_obstructed: analysis.camera_health === 'obstructed',
    potential_visual_assistance: analysis.potential_visual_assistance.flagged,
  });
  if (!qualified.length) return res.json({ analysis, recorded: [], evidenceAttached: false, temporalRule: '3_of_5_frames' });

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
  if (!freshSignals.length) return res.json({ analysis, recorded: duplicates, evidenceAttached: false, temporalRule: '3_of_5_frames' });

  const storage = req.app.get('storage') as StorageInterface;
  if (!storage.storageConfigured()) return res.status(503).json({ error: 'AI signals were observed repeatedly, but private evidence storage is not configured. Configure private object storage before using AI incident capture.' });
  const used = (await prisma.evidenceObject.aggregate({ where: { organizationId: attempt.organizationId }, _sum: { sizeBytes: true } }))._sum.sizeBytes ?? 0;
  const quota = evaluateQuota({ usedBytes: used, incomingBytes: req.file.size, quotaBytes: parseQuotaBytes(process.env.EVIDENCE_ORG_QUOTA_MB) });
  if (!quota.allowed) return res.status(507).json({ error: 'Private evidence storage is full for this organization; the AI signal was not turned into an incident.' });
  const evidenceKey = `organizations/${attempt.organizationId}/attempts/${attempt.id}/evidence/${crypto.randomUUID()}`;
  await storage.putPrivateDocument(evidenceKey, req.file.buffer, req.file.mimetype);
  await prisma.evidenceObject.create({ data: { organizationId: attempt.organizationId, attemptId: attempt.id, objectKey: evidenceKey, sizeBytes: req.file.size, mimeType: req.file.mimetype } });

  const recorded: Array<{ type: string; incidentId?: string; eventId?: string; occurredAt?: string; deduplicated?: boolean }> = [...duplicates];
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
        facePoseEstimates: analysis.face_pose_estimates,
        phoneConfidence: analysis.phone_confidence ?? null,
        faceBoxes: analysis.face_boxes,
        phoneBoxes: analysis.phone_boxes,
        visibleDevices: analysis.visible_devices,
        readabilityAssessment: analysis.readability_assessment ?? null,
        potentialVisualAssistance: analysis.potential_visual_assistance,
        proximityObservations: proximityContext,
        advertisedNameStorageAvailable: analysis.advertised_name_storage_available ?? null,
        cameraHealth: analysis.camera_health,
        frameQuality: analysis.frame_quality ?? null,
        inferenceMs: analysis.inference_ms ?? null,
        modelVersion: analysis.service_version ?? 'unknown',
        temporalConfirmation: '3_of_5_frames',
        disclosure: 'AI signal for human review only; approximate head orientation is not eye-gaze tracking.'
      } as Prisma.InputJsonValue
    } });
    const weight = Number((config.signalWeights as Record<string, number>)[type] ?? (type === 'potential_visual_assistance' ? 10 : 0));
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
    recorded.push({ type, incidentId: incident.id, eventId: event.id, occurredAt: occurredAt.toISOString() });
  }
  res.status(recorded.some(item => item.incidentId) ? 201 : 202).json({ analysis, recorded, evidenceAttached: true, temporalRule: '3_of_5_frames' });
} catch (error) { next(error); } });

app.post('/api/student/attempts/:attemptId/ai-context-frame', authenticate, aiFrameLimiter, upload.single('frame'), validateFileContent, async (req: AuthRequest, res, next) => { try {
  const contextInput = z.object({
    parentEventId: z.string().uuid(),
    contextType: z.enum(['before', 'after']),
    sequence: z.coerce.number().int().min(0).max(20),
    capturedAt: z.string().datetime(),
  }).parse(req.body);
  const attempt = await prisma.examAttempt.findFirst({ where: { id: String(req.params.attemptId), userId: req.auth!.userId, status: 'in_progress', deadlineAt: { gt: new Date() } } });
  if (!attempt) return res.status(409).json({ error: 'An active authorized attempt is required' });
  if (!attempt.monitoringConsentAt || attempt.monitoringConsentVersion !== 'examguard-monitoring-v2') return res.status(403).json({ error: 'Monitoring consent is not recorded for this attempt' });
  if (!req.file || !['image/jpeg', 'image/png', 'image/webp'].includes(req.file.mimetype)) return res.status(415).json({ error: 'A JPEG, PNG, or WebP context frame is required' });
  const capturedAt = new Date(contextInput.capturedAt);
  const now = new Date();
  if (capturedAt.getTime() > now.getTime() + 10_000 || capturedAt.getTime() < now.getTime() - 30_000) return res.status(400).json({ error: 'Context frame timestamp is outside the permitted capture window' });
  const parentEvent = await prisma.proctoringEvent.findFirst({
    where: { id: contextInput.parentEventId, organizationId: attempt.organizationId, attemptId: attempt.id, source: 'ai_service', evidenceKey: { not: null }, incidents: { some: {} } },
    include: { incidents: { select: { incidentId: true } } },
  });
  if (!parentEvent) return res.status(404).json({ error: 'The incident event is not associated with this attempt' });
  if (contextInput.contextType === 'before' && (capturedAt.getTime() > parentEvent.occurredAt.getTime() || capturedAt.getTime() < parentEvent.occurredAt.getTime() - 5_000)) return res.status(400).json({ error: 'A before-context frame must precede the incident and remain within five seconds' });
  if (contextInput.contextType === 'after' && (capturedAt.getTime() < parentEvent.occurredAt.getTime() || capturedAt.getTime() > parentEvent.occurredAt.getTime() + 5_000)) return res.status(400).json({ error: 'An after-context frame must follow the incident and remain within five seconds' });
  const storage = req.app.get('storage') as StorageInterface;
  if (!storage.storageConfigured()) return res.status(503).json({ error: 'Private evidence storage is not configured' });
  const fingerprint = fingerprintFor(
    attempt.organizationId,
    attempt.candidateId,
    `ai_context_frame:${parentEvent.id}:${contextInput.contextType}:${contextInput.sequence}`,
    0,
  );
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw<Array<{ lock: string }>>`SELECT pg_advisory_xact_lock(hashtext(${parentEvent.id})::bigint)::text AS lock`;
    const duplicate = await tx.proctoringEvent.findFirst({
      where: { organizationId: attempt.organizationId, attemptId: attempt.id, fingerprint },
      select: { id: true, evidenceKey: true },
    });
    if (duplicate) return { kind: 'duplicate' as const, eventId: duplicate.id, evidenceKey: duplicate.evidenceKey };

    const existingFrames = await tx.proctoringEvent.findMany({
      where: { organizationId: attempt.organizationId, attemptId: attempt.id, details: { path: ['parentEventId'], equals: parentEvent.id } },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      select: { occurredAt: true, details: true },
    });
    const framesOfType = existingFrames.filter(frame =>
      frame.details !== null &&
      typeof frame.details === 'object' &&
      !Array.isArray(frame.details) &&
      frame.details.contextType === contextInput.contextType,
    );
    if (contextInput.contextType === 'after' && !existingFrames.some(frame =>
      frame.details !== null &&
      typeof frame.details === 'object' &&
      !Array.isArray(frame.details) &&
      frame.details.contextType === 'before',
    )) return { kind: 'before_required' as const };
    if (contextInput.sequence !== framesOfType.length) return { kind: 'out_of_order' as const };
    const previousFrame = framesOfType.at(-1);
    if (previousFrame && capturedAt.getTime() <= previousFrame.occurredAt.getTime()) return { kind: 'out_of_order' as const };

    const used = (await tx.evidenceObject.aggregate({ where: { organizationId: attempt.organizationId }, _sum: { sizeBytes: true } }))._sum.sizeBytes ?? 0;
    const quota = evaluateQuota({ usedBytes: used, incomingBytes: req.file!.size, quotaBytes: parseQuotaBytes(process.env.EVIDENCE_ORG_QUOTA_MB) });
    if (!quota.allowed) return { kind: 'quota_full' as const };
    const key = `organizations/${attempt.organizationId}/attempts/${attempt.id}/evidence/${crypto.randomUUID()}`;
    await storage.putPrivateDocument(key, req.file!.buffer, req.file!.mimetype);
    await tx.evidenceObject.create({ data: { organizationId: attempt.organizationId, attemptId: attempt.id, objectKey: key, sizeBytes: req.file!.size, mimeType: req.file!.mimetype } });
    const contextEvent = await tx.proctoringEvent.create({
      data: {
        organizationId: attempt.organizationId,
        examId: attempt.examId,
        candidateId: attempt.candidateId,
        attemptId: attempt.id,
        type: 'ai_context_frame',
        occurredAt: capturedAt,
        source: 'ai_service',
        evidenceKey: key,
        fingerprint,
        policyAction: 'recorded',
        details: {
          parentEventId: parentEvent.id,
          contextType: contextInput.contextType,
          sequence: contextInput.sequence,
          capturedAt: capturedAt.toISOString(),
          temporalConfirmation: 'linked_to_confirmed_incident',
        } as Prisma.InputJsonValue,
      },
    });
    await tx.incidentEvent.createMany({ data: parentEvent.incidents.map(({ incidentId }) => ({ incidentId, eventId: contextEvent.id })), skipDuplicates: true });
    return { kind: 'created' as const, eventId: contextEvent.id, evidenceKey: key };
  });
  if (result.kind === 'before_required') return res.status(409).json({ error: 'At least one valid before-context frame is required before after-context frames.' });
  if (result.kind === 'out_of_order') return res.status(409).json({ error: 'Context frames must be uploaded once and in sequence.' });
  if (result.kind === 'quota_full') return res.status(507).json({ error: 'Private evidence storage is full for this organization' });
  if (result.kind === 'duplicate') return res.status(200).json({ evidenceKey: result.evidenceKey, eventId: result.eventId, duplicate: true });
  await audit(attempt.organizationId, req.auth!.userId, 'evidence.ai_context_captured', 'ProctoringEvent', result.eventId, { parentEventId: parentEvent.id, contextType: contextInput.contextType, sequence: contextInput.sequence, capturedAt: capturedAt.toISOString() });
  res.status(201).json({ evidenceKey: result.evidenceKey, eventId: result.eventId });
} catch (error) { next(error); } });

app.post('/api/organizations/:organizationId/proctoring/events', authenticate, async (req: AuthRequest, res, next) => { try {
  const data = proctorEventInput.parse(req.body);
  const organizationId = String(req.params.organizationId);
  const now = new Date();
  const attempt = await prisma.examAttempt.findFirst({ where: { id: data.attemptId, organizationId, userId: req.auth!.userId, status: 'in_progress', deadlineAt: { gt: now } } });
  const candidate = attempt && attempt.candidateId === data.candidateId
    ? await prisma.candidate.findFirst({ where: { id: attempt.candidateId, organizationId: attempt.organizationId, userId: req.auth!.userId } })
    : null;
  const exam = await prisma.exam.findFirst({ where: { id: data.examId, organizationId } });
  if (!candidate || !attempt || attempt.examId !== data.examId || !exam) return res.status(403).json({ error: 'An active authorized attempt is required' });
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
  if (!attempt.monitoringConsentAt || attempt.monitoringConsentVersion !== 'examguard-monitoring-v2') return res.status(403).json({ error: 'Explicit monitoring consent must be recorded before Companion connection.' });
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
  if (!attempt.monitoringConsentAt || attempt.monitoringConsentVersion !== 'examguard-monitoring-v2') return res.status(403).json({ error: 'Monitoring consent is not recorded for this attempt' });
  const organizationId = candidate.organizationId;
  const observedAt = new Date();
  const fingerprint = fingerprintFor(organizationId, attempt.id, `${data.source}:${data.kind}:${data.pseudonym ?? data.errorCode ?? 'health'}`, dedupeWindow(observedAt, 30));
  const limitations = data.source === 'bluetooth_le' ? 'BLE advertisements do not identify a device type; addresses may rotate and many phones do not advertise.' : data.source === 'wifi' ? 'Wi-Fi scans observe access points, not nearby clients or every phone; a hotspot is not proof of a prohibited device.' : 'Scanner health is technical telemetry and is not evidence of student conduct.';
  const fields = { examId: data.examId, candidateId: candidate.id, attemptId: attempt.id, source: data.source, kind: data.kind, rssi: data.rssi, pseudonym: data.pseudonym, scannerStatus: data.scannerStatus, errorCode: data.errorCode, observedAt, limitations, expiresAt: new Date(observedAt.getTime() + 30 * 24 * 60 * 60_000) };
  const observationResult = await withAdvertisedNameCompatibility(includeAdvertisedName => {
    const namedFields = includeAdvertisedName ? { ...fields, advertisedName: data.advertisedName } : fields;
    return prisma.radioObservation.upsert({
      where: { organizationId_fingerprint: { organizationId, fingerprint } },
      update: namedFields,
      create: { ...namedFields, organizationId, fingerprint },
      select: radioObservationSelect(includeAdvertisedName),
    });
  });
  const observation = observationResult.result;
  let signalId: string | undefined;
  if (data.kind === 'advertisement' || data.kind === 'access_point') {
    const windowStart = new Date(observedAt.getTime() - 5 * 60_000);
    const recent = await prisma.radioObservation.findMany({ where: { organizationId, attemptId: attempt.id, source: data.source, kind: data.kind, observedAt: { gte: windowStart } }, orderBy: { observedAt: 'desc' }, take: 3, select: { id: true } });
    if (recent.length >= 3) {
      const rule = `repeated_${data.source}_observation`;
      const existing = await prisma.radioCandidateSignal.findFirst({ where: { organizationId, attemptId: attempt.id, rule, status: 'pending_review' } });
      const signal = existing ?? await prisma.radioCandidateSignal.create({ data: { organizationId, examId: data.examId, candidateId: candidate.id, attemptId: attempt.id, rule, label: 'Repeated nearby radio observation — device type unknown', observations: { create: recent.map(x => ({ observationId: x.id })) } } });
      signalId = signal.id;
    }
  }
  await audit(organizationId, companion.userId, 'radio.observation_recorded', 'RadioObservation', observation.id, { source: data.source, kind: data.kind, signalId });
  res.status(201).json({ observationId: observation.id, candidateSignalId: signalId, advertisedNameStored: observationResult.advertisedNameAvailable && Boolean(data.advertisedName), ...(data.advertisedName && !observationResult.advertisedNameAvailable ? { warning: 'The current database schema does not yet store BLE advertised names. Apply the pending radio advertised-name migration to enable this field.' } : {}), disposition: data.kind === 'advertisement' || data.kind === 'access_point' ? 'recorded_for_possible_review' : 'technical_status_recorded' });
} catch (error) { next(error); } });
app.get('/api/organizations/:organizationId/radio-observations', authenticate, authorize('institute_admin', 'teacher', 'proctor'), async (req: AuthRequest, res, next) => { try {
  const organizationId = req.auth!.organizationId!;
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const [observationResult, signalResult] = await Promise.all([
    withAdvertisedNameCompatibility(includeAdvertisedName =>
      prisma.radioObservation.findMany({
        where: { organizationId },
        orderBy: { observedAt: 'desc' },
        take: limit,
        select: radioObservationSelect(includeAdvertisedName),
      })),
    withAdvertisedNameCompatibility(includeAdvertisedName =>
      prisma.radioCandidateSignal.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: { observations: { include: { observation: { select: radioObservationSelect(includeAdvertisedName) } } } },
      })),
  ]);
  res.json({ observations: observationResult.result, advertisedNameAvailable: observationResult.advertisedNameAvailable, signals: signalResult.result.map(({ observations: links, ...signal }) => ({ ...signal, observationIds: links.map(link => link.observation) })) });
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
    { advertisedName: { contains: filters.search, mode: 'insensitive' as const } },
    { errorCode: { contains: filters.search, mode: 'insensitive' as const } },
    ...(['bluetooth_le', 'wifi', 'scanner_health'].includes(filters.search) ? [{ source: filters.search }] : []),
    ...(['advertisement', 'access_point', 'scan_unavailable', 'permission_denied', 'scan_error', 'scan_stopped'].includes(filters.search) ? [{ kind: filters.search }] : []),
  ] : undefined;
  const incidentFilters: any[] = [
    ...(filters.incidentId ? [{ incidents: { some: { incidentId: filters.incidentId } } }] : []),
    ...(filters.reviewStatus === 'pending_review' ? [{ incidents: { some: { incident: { status: { in: ['open', 'awaiting_student'] } } } } }] : []),
    ...(filters.reviewStatus === 'reviewed' ? [
      { incidents: { some: { incident: { status: { in: ['dismissed', 'resolved'] } } } } },
      { incidents: { none: { incident: { status: { in: ['open', 'awaiting_student', 'escalated'] } } } } },
    ] : []),
    ...(filters.reviewStatus === 'escalated' ? [{ incidents: { some: { incident: { status: 'escalated' } } } }] : []),
  ];
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
    ...(incidentFilters.length ? { AND: incidentFilters } : {}),
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
  const includeRadio = !filters.incidentId && (!filters.type || filters.type === 'radio_observation');
  const includeCode = !filters.incidentId && (!filters.type || filters.type === 'coding_submission');
  const offset = evidenceOffset(filters.page, filters.pageSize);
  const [eventCount, radioCount, codeCount, events, radiosResult, codeSubmissions] = await Promise.all([
    includeEvents ? prisma.proctoringEvent.count({ where: eventWhere }) : 0,
    includeRadio ? prisma.radioObservation.count({ where: radioWhere }) : 0,
    includeCode && !filters.reviewStatus ? prisma.codeSubmission.count({ where: codeWhere }) : 0,
    includeEvents ? prisma.proctoringEvent.findMany({ where: eventWhere, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: offset + filters.pageSize, include: { candidate: { select: { id: true, name: true, email: true } }, exam: { select: { id: true, title: true } }, attempt: { select: { id: true, status: true } }, incidents: { include: { incident: { select: { id: true, status: true, decisionReason: true, reviewerNotes: true, createdAt: true, updatedAt: true } } } } } }) : [],
    includeRadio ? withAdvertisedNameCompatibility(includeAdvertisedName =>
      prisma.radioObservation.findMany({
        where: radioWhere,
        orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
        take: offset + filters.pageSize,
        select: {
          ...radioObservationSelect(includeAdvertisedName),
          candidate: { select: { id: true, name: true, email: true } },
          exam: { select: { id: true, title: true } },
          attempt: { select: { id: true, status: true } },
          signals: { select: { signal: { select: { id: true, status: true, reviewerNotes: true, reviewerId: true, createdAt: true, updatedAt: true } } } },
        },
      })) : Promise.resolve({ result: [], advertisedNameAvailable: false }),
    includeCode && !filters.reviewStatus ? prisma.codeSubmission.findMany({ where: codeWhere, orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }], take: offset + filters.pageSize, include: { candidate: { select: { id: true, name: true, email: true } }, attempt: { select: { id: true, status: true, exam: { select: { id: true, title: true } } } }, codingQuestion: { select: { id: true, title: true } } } }) : [],
  ]);
  const radios = radiosResult.result;
  const items: Array<Record<string, any>> = [];
  for (const event of events as any[]) {
    const reviewStatus = incidentReviewStatus(event.incidents.map((link: any) => link.incident.status));
    items.push({ id: event.id, kind: event.evidenceKey ? 'image' : event.source === 'ai_service' ? 'ai_signal' : 'browser_event', type: event.type, source: event.source, occurredAt: event.occurredAt, organizationId, candidate: event.candidate, exam: event.exam, attempt: event.attempt, hasBinary: Boolean(event.evidenceKey), reviewStatus, details: sanitizeEvidenceDetails(event.details) as Record<string, unknown> | undefined, incidents: event.incidents.map((link: any) => ({ id: link.incident.id, status: link.incident.status, decisionReason: link.incident.decisionReason, reviewerNotes: link.incident.reviewerNotes })) });
  }
  for (const observation of radios as any[]) {
    const statuses = observation.signals.map((link: any) => link.signal.status);
    items.push({ id: observation.id, kind: 'radio_observation', type: `${observation.source}:${observation.kind}`, source: observation.source, occurredAt: observation.observedAt, organizationId, candidate: observation.candidate, exam: observation.exam, attempt: observation.attempt, hasBinary: false, reviewStatus: radioReviewStatus(statuses), details: { kind: observation.kind, rssi: observation.rssi, proximity: radioProximity(observation.source, observation.rssi), pseudonym: observation.pseudonym, advertisedName: observation.advertisedName ?? null, advertisedNameAvailable: radiosResult.advertisedNameAvailable, scannerStatus: observation.scannerStatus, errorCode: observation.errorCode, limitations: observation.limitations }, signals: observation.signals.map((link: any) => ({ id: link.signal.id, status: link.signal.status, reviewerNotes: link.signal.reviewerNotes })) });
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
    const contextFrames = event.type === 'ai_context_frame' ? [] : await prisma.proctoringEvent.findMany({
      where: { organizationId, attemptId: event.attempt.id, details: { path: ['parentEventId'], equals: event.id } },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      select: { id: true, type: true, source: true, occurredAt: true, evidenceKey: true, details: true },
    });
    return res.json({ item: { id: event.id, kind: event.evidenceKey ? 'image' : kind, type: event.type, source: event.source, occurredAt: event.occurredAt, candidate: event.candidate, exam: event.exam, attempt: event.attempt, details: sanitizeEvidenceDetails(event.details), contextFrames: contextFrames.map(frame => ({ id: frame.id, kind: 'image', type: frame.type, source: frame.source, occurredAt: frame.occurredAt, hasBinary: Boolean(frame.evidenceKey), details: sanitizeEvidenceDetails(frame.details) })), incidents: event.incidents.map(link => link.incident) }, reviewHistory });
  }
  if (kind === 'radio_observation') {
    const observationResult = await withAdvertisedNameCompatibility(includeAdvertisedName =>
      prisma.radioObservation.findFirst({
        where: { id: evidenceId, organizationId },
        select: {
          ...radioObservationSelect(includeAdvertisedName),
          candidate: { select: { id: true, name: true, email: true, organizationId: true } },
          exam: { select: { id: true, title: true, organizationId: true } },
          attempt: { select: { id: true, status: true, organizationId: true, examId: true, candidateId: true } },
          signals: { select: { signal: { select: { id: true, status: true, reviewerNotes: true, reviewerId: true, createdAt: true, updatedAt: true } } } },
        },
      }));
    const observation = observationResult.result;
    if (!observation || !evidenceAttemptScopeMatches(observation.attempt, observation, organizationId) || observation.exam.organizationId !== organizationId || observation.candidate.organizationId !== organizationId) return res.status(404).json({ error: 'Evidence not found' });
    await audit(organizationId, req.auth!.userId, 'evidence.detail_viewed', 'RadioObservation', observation.id);
    const signalIds = observation.signals.map(link => link.signal.id);
    const reviewHistory = signalIds.length ? await prisma.auditLog.findMany({ where: { organizationId, targetType: 'RadioCandidateSignal', targetId: { in: signalIds } }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, action: true, metadata: true, createdAt: true, actor: { select: { name: true } } } }) : [];
    return res.json({ item: { id: observation.id, kind, type: `${observation.source}:${observation.kind}`, occurredAt: observation.observedAt, candidate: observation.candidate, exam: observation.exam, attempt: observation.attempt, details: { kind: observation.kind, rssi: observation.rssi, proximity: radioProximity(observation.source, observation.rssi), pseudonym: observation.pseudonym, advertisedName: observation.advertisedName ?? null, advertisedNameAvailable: observationResult.advertisedNameAvailable, scannerStatus: observation.scannerStatus, errorCode: observation.errorCode, limitations: observation.limitations }, signals: observation.signals.map(link => link.signal) }, reviewHistory });
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
  const exam = await prisma.exam.findFirst({ where: { id: attempt.examId, organizationId }, select: { isPractice: true } });
  if (!exam) return res.status(404).json({ error: 'Submitted attempt not found' });
  if (exam.isPractice) return res.status(409).json({ error: 'Practice attempts are not included in official grading' });
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
  const existing = await prisma.grade.findFirst({ where: { id: String(req.params.gradeId), organizationId, exam: { isPractice: false } } });
  if (!existing || existing.status === 'published') return res.status(404).json({ error: 'Editable grade not found' });
  if (!manualMarksWithinBounds(existing.autoMarks, data.manualMarks, existing.maxMarks)) return res.status(400).json({ error: `Manual marks must keep the total within the maximum of ${existing.maxMarks}` });
  const grade = await prisma.grade.update({ where: { id: existing.id }, data: { manualMarks: data.manualMarks, totalMarks: existing.autoMarks + data.manualMarks, feedback: data.feedback, status: 'graded' } });
  await audit(organizationId, req.auth!.userId, 'grade.manual_evaluated', 'Grade', grade.id);
  res.json(grade);
} catch (error) { next(error); } });
app.post('/api/organizations/:organizationId/grades/:gradeId/publish', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
  const organizationId = req.auth!.organizationId!;
  const gradeId = String(req.params.gradeId);
  const published = await prisma.grade.updateMany({ where: { id: gradeId, organizationId, status: 'graded', exam: { isPractice: false } }, data: { status: 'published', publishedAt: new Date(), publishedById: req.auth!.userId } });
  if (published.count === 0) return res.status(404).json({ error: 'Graded result not found' });
  const grade = await prisma.grade.findUniqueOrThrow({ where: { id: gradeId } });
  const candidate = await prisma.candidate.findUnique({ where: { id: grade.candidateId } });
  if (candidate?.userId) await notify(organizationId, candidate.userId, 'result_published', 'Result published', 'Your exam result is now available.', { gradeId: grade.id });
  await audit(organizationId, req.auth!.userId, 'grade.published', 'Grade', grade.id);
  res.json(grade);
} catch (error) { next(error); } });
app.post('/api/organizations/:organizationId/exams/:examId/grades/publish', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
  const organizationId = req.auth!.organizationId!;
  const examId = String(req.params.examId);
  const exam = await prisma.exam.findFirst({ where: { id: examId, organizationId }, select: { id: true, isPractice: true } });
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  if (exam.isPractice) return res.status(409).json({ error: 'Practice exam results cannot be published' });

  const result = await prisma.$transaction(async tx => {
    const [readyGrades, pendingManualCount] = await Promise.all([
      tx.grade.findMany({
        where: { organizationId, examId, status: 'graded' },
        select: { id: true, candidate: { select: { userId: true } } },
      }),
      tx.grade.count({ where: { organizationId, examId, status: 'pending_manual' } }),
    ]);
    const publishedAt = new Date();
    let publishedCount = 0;
    let notifiedCount = 0;
    for (const grade of readyGrades) {
      const updated = await tx.grade.updateMany({
        where: { id: grade.id, organizationId, examId, status: 'graded' },
        data: { status: 'published', publishedAt, publishedById: req.auth!.userId },
      });
      if (updated.count !== 1) continue;
      publishedCount++;
      await tx.auditLog.create({ data: { organizationId, actorId: req.auth!.userId, action: 'grade.published', targetType: 'Grade', targetId: grade.id } });
      if (grade.candidate.userId) {
        await tx.notification.create({ data: {
          organizationId,
          userId: grade.candidate.userId,
          type: 'result_published',
          title: 'Result published',
          body: 'Your exam result is now available.',
          metadata: { gradeId: grade.id } as Prisma.InputJsonValue,
          delivery: 'email_unconfigured',
        } });
        notifiedCount++;
      }
    }
    await tx.auditLog.create({
      data: {
        organizationId,
        actorId: req.auth!.userId,
        action: 'results.declared',
        targetType: 'Exam',
        targetId: examId,
        metadata: { publishedCount, pendingManualCount } as Prisma.InputJsonValue,
      },
    });
    return { publishedCount, pendingManualCount, notifiedCount };
  });

  res.json({
    publishedCount: result.publishedCount,
    pendingManualCount: result.pendingManualCount,
    notifiedCount: result.notifiedCount,
  });
} catch (error) { next(error); } });
app.get('/api/organizations/:organizationId/reports/summary', authenticate, authorize('institute_admin', 'teacher', 'proctor'), async (req: AuthRequest, res, next) => { try {
  const organizationId = req.auth!.organizationId!;
  if (req.query.examId !== undefined && !isUuid(req.query.examId)) return res.status(400).json({ error: 'Invalid examId' });
  const examId = isUuid(req.query.examId) ? req.query.examId : undefined;
  const since = typeof req.query.from === 'string' ? new Date(req.query.from) : undefined;
  const byExam = examId ? { examId } : {};
  const attemptWhere = { organizationId, ...byExam, exam: { isPractice: false }, ...(since && !Number.isNaN(+since) ? { createdAt: { gte: since } } : {}) };
  const [assigned, attempts, submitted, incidents, verificationApproved, grades] = await Promise.all([
    prisma.examAssignment.count({ where: { organizationId, ...byExam, exam: { isPractice: false } } }),
    prisma.examAttempt.count({ where: attemptWhere }),
    prisma.examAttempt.count({ where: { ...attemptWhere, status: { in: ['submitted', 'expired'] } } }),
    prisma.incident.count({ where: { organizationId, ...byExam, exam: { isPractice: false } } }),
    prisma.verificationRequest.count({ where: { organizationId, status: 'approved' } }),
    prisma.grade.findMany({ where: { organizationId, ...byExam, exam: { isPractice: false } } })
  ]);
  res.json({ completionRate: assigned ? submitted / assigned : 0, submission: { assigned, attempts, submitted }, incidents, verificationApproved, grades: grades.map(g => ({ candidateId: g.candidateId, totalMarks: g.totalMarks, maxMarks: g.maxMarks, status: g.status })) });
} catch (error) { next(error); } });
app.get('/api/organizations/:organizationId/reports/export.csv', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
  const organizationId = req.auth!.organizationId!;
  if (req.query.examId !== undefined && !isUuid(req.query.examId)) return res.status(400).json({ error: 'Invalid examId' });
  const examId = isUuid(req.query.examId) ? req.query.examId : undefined;
  const grades = await prisma.grade.findMany({ where: { organizationId, exam: { isPractice: false }, ...(examId ? { examId } : {}) }, include: { candidate: { select: { name: true } } }, orderBy: { createdAt: 'asc' }, take: 10_000 });
  // Results contain personal data: every export is audited.
  await audit(organizationId, req.auth!.userId, 'reports.exported', 'Report', organizationId, { rows: grades.length, examId: examId ?? null, format: 'csv' });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="examguard-results.csv"');
  res.send(toCsv(['candidate', 'score', 'max_marks', 'status'], grades.map(g => [g.candidate.name, g.totalMarks, g.maxMarks, g.status])));
} catch (error) { next(error); } });
app.get('/api/notifications', authenticate, async (req: AuthRequest, res, next) => { try {
  const emailConfigured = !!emailProviderFromEnv();
  res.json({ emailConfigured, emailStatus: emailConfigured ? 'configured' : 'unavailable: configure SMTP or webhook email delivery', notifications: await prisma.notification.findMany({ where: { userId: req.auth!.userId }, orderBy: { createdAt: 'desc' }, take: 50 }) });
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
registerStudentInvitationRoutes(app);
registerSupportRoutes(app);
app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input', details: error.flatten() });
  if (error instanceof multer.MulterError) return res.status(uploadErrorHttpStatus(error.code)).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'File exceeds the 5 MB upload limit' : 'Invalid upload' });
  if (error instanceof Error && error.message === 'Unexpected end of form') return res.status(400).json({ error: 'Malformed multipart upload' });
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const mapped = prismaErrorResponse(error.code);
    if (mapped) return res.status(mapped.status).json({ error: mapped.message });
  }
  const requestId = crypto.randomUUID();
  console.error(`[${requestId}] ${req.method} ${req.originalUrl}`, error);
  res.status(500).json({ error: 'Unexpected server error', requestId });
});

  return app;
}
