import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import { z } from "zod";
import multer from "multer";
import rateLimit from "express-rate-limit";
import {
  authenticate,
  authenticateCompanion,
  authorize,
  signCompanionToken,
  signToken,
  tenantFilter,
  type AuthRequest,
} from "./auth.js";
import {
  AttemptAnswer,
  AuditLog,
  AuthIdentity,
  Candidate,
  Exam,
  ExamAssignment,
  ExamAttempt,
  Grade,
  Incident,
  InstitutionRequest,
  Membership,
  Notification,
  OAuthAuthorization,
  Organization,
  PasswordResetToken,
  ProctoringConfig,
  ProctoringEvent,
  Question,
  QuestionBank,
  RadioCandidateSignal,
  RadioObservation,
  StudentExplanation,
  User,
  VerificationRequest,
} from "./models.js";
import { canStartExam, deadlineFor, isAttemptOpen } from "./exam.js";
import { putPrivateDocument, storageConfigured } from "./storage.js";
import { dedupeWindow, fingerprintFor, reviewPriority } from "./proctor.js";
import { automaticallyGrade } from "./grading.js";
import {
  createResetToken,
  hashResetToken,
  passwordPolicy,
} from "./password-reset.js";
import { sendPasswordResetEmail } from "./mailer.js";
import { loadConfig } from "./config.js";
import { regionsForCountry, searchDirectory } from "./institutions.js";
import { interventionFor } from "./intervention.js";
import {
  beginAuthorization,
  configuredProviders,
  finishAuthorization,
  type OAuthProvider,
} from "./oauth.js";

const registration = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(10),
  organizationName: z.string().min(2),
});
const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
const resetRequest = z.object({ email: z.string().email() });
const resetPassword = z
  .object({
    token: z.string().min(20).max(200),
    password: z.string().min(10),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
const examInput = z.object({
  title: z.string().min(3),
  instructions: z.string().max(10000).default(""),
  durationMinutes: z.number().int().positive().default(60),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  randomizeQuestions: z.boolean().default(false),
  randomizeOptions: z.boolean().default(false),
  requireVerification: z.boolean().default(true),
  interventionPolicy: z
    .object({
      windowSeconds: z.number().int().min(30).max(3600).default(300),
      warningAt: z.number().int().min(1).default(1),
      pauseAt: z.number().int().min(2).default(3),
      terminateAt: z.number().int().min(3).default(5),
      automaticTerminationEnabled: z.boolean().default(false),
      fullscreenRequired: z.boolean().default(false),
    })
    .default({
      windowSeconds: 300,
      warningAt: 1,
      pauseAt: 3,
      terminateAt: 5,
      automaticTerminationEnabled: false,
      fullscreenRequired: false,
    }),
  accessCode: z.string().min(4).optional(),
});
const questionInput = z.object({
  type: z.enum([
    "mcq",
    "multiple_select",
    "true_false",
    "short_answer",
    "descriptive",
  ]),
  prompt: z.string().min(1),
  options: z.array(z.object({ id: z.string(), text: z.string() })).default([]),
  correctAnswer: z.unknown().optional(),
  marks: z.number().positive(),
  negativeMarks: z.number().min(0).default(0),
});
const validateAnswerValue = (
  question: { type: string; options?: ReadonlyArray<{ id?: string | null }> },
  value: unknown,
) => {
  const optionIds = new Set(
    Array.from(question.options ?? [])
      .map((option) => option.id)
      .filter((id): id is string => typeof id === "string"),
  );
  if (question.type === "multiple_select") {
    const selected = z.array(z.string()).max(optionIds.size).parse(value);
    if (new Set(selected).size !== selected.length || selected.some((id) => !optionIds.has(id)))
      throw new z.ZodError([{ code: "custom", path: ["value"], message: "Invalid selected option" }]);
    return selected;
  }
  if (question.type === "mcq" || question.type === "true_false") {
    const selected = z.string().parse(value);
    if (!optionIds.has(selected))
      throw new z.ZodError([{ code: "custom", path: ["value"], message: "Invalid selected option" }]);
    return selected;
  }
  return z.string().max(50_000).parse(value);
};
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    cb(
      null,
      ["image/jpeg", "image/png", "application/pdf"].includes(file.mimetype),
    ),
});
const audit = (
  organizationId: string,
  actorId: string,
  action: string,
  targetType: string,
  targetId: string,
  metadata?: unknown,
) =>
  AuditLog.create({
    organizationId,
    actorId,
    action,
    targetType,
    targetId,
    metadata,
  });
const notify = async (
  organizationId: string,
  userId: unknown,
  type: string,
  title: string,
  body: string,
  metadata?: unknown,
) =>
  Notification.create({
    organizationId,
    userId,
    type,
    title,
    body,
    metadata,
    delivery: "email_unconfigured",
  });
const proctorEventInput = z.object({
  examId: z.string(),
  candidateId: z.string(),
  sessionId: z.string().optional(),
  attemptId: z.string(),
  type: z.enum([
    "face_missing",
    "multiple_faces",
    "looking_away",
    "phone_detected",
    "visibility_hidden",
    "fullscreen_exit",
    "network_interruption",
    "camera_permission_lost",
  ]),
  occurredAt: z.string().datetime(),
  source: z.literal("browser"),
  details: z.record(z.unknown()).optional(),
  evidenceKey: z.never().optional(),
});
const radioObservationInput = z
  .object({
    organizationId: z.string(),
    examId: z.string(),
    candidateId: z.string(),
    attemptId: z.string(),
    source: z.enum(["bluetooth_le", "wifi", "scanner_health"]),
    kind: z.enum([
      "advertisement",
      "access_point",
      "scan_unavailable",
      "permission_denied",
      "scan_error",
      "scan_stopped",
    ]),
    rssi: z.number().int().min(-127).max(0).optional(),
    pseudonym: z.string().min(16).max(128).optional(),
    scannerStatus: z.enum([
      "active",
      "unavailable",
      "permission_denied",
      "stopped",
      "error",
    ]),
    errorCode: z.string().max(120).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.kind === "advertisement" || data.kind === "access_point") {
      if (!data.pseudonym)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "A session-scoped pseudonym is required for a radio observation",
        });
      if (data.scannerStatus !== "active")
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Radio observations require an active scanner status",
        });
    }
  });
export const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: process.env.CLIENT_URL ?? "http://localhost:5173" }));
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  if (process.env.NODE_ENV === "production")
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});
app.use(express.json());
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(
  "/api/auth",
  rateLimit({
    windowMs: 15 * 60_000,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  }),
);
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});
const directoryLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});
const radioObservationLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});
app.use(
  "/api",
  rateLimit({
    windowMs: 60_000,
    limit: 240,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  }),
);
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/api/auth/providers", (_req, res) => {
  const providers = configuredProviders();
  res.json({
    providers,
    status: providers.length ? "configured" : "not_configured",
    message: providers.length
      ? undefined
      : "Google or Microsoft credentials have not been configured by this institution.",
  });
});
app.get("/api/auth/oauth/:provider/start", async (req, res, next) => {
  try {
    const provider = z
      .enum(["google", "microsoft"])
      .parse(req.params.provider) as OAuthProvider;
    const redirectUri = `${loadConfig().API_BASE_URL.replace(/\/$/, "")}/api/auth/oauth/${provider}/callback`;
    const authorization = await beginAuthorization(provider, redirectUri);
    await OAuthAuthorization.create({
      provider,
      ...authorization,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
    res.redirect(303, authorization.url);
  } catch (error) {
    next(error);
  }
});
app.get("/api/auth/oauth/:provider/callback", async (req, res) => {
  try {
    const provider = z
      .enum(["google", "microsoft"])
      .parse(req.params.provider) as OAuthProvider;
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const stored = await OAuthAuthorization.findOneAndDelete({
      provider,
      state,
      expiresAt: { $gt: new Date() },
    });
    if (!stored)
      return res
        .status(400)
        .send(
          "This sign-in request has expired or is invalid. Please return to ExamGuard and try again.",
        );
    const config = loadConfig();
    const redirectUri = `${config.API_BASE_URL.replace(/\/$/, "")}/api/auth/oauth/${provider}/callback`;
    const identity = await finishAuthorization(
      provider,
      redirectUri,
      `${config.API_BASE_URL.replace(/\/$/, "")}${req.originalUrl}`,
      stored.state,
      stored.nonce,
      stored.codeVerifier,
    );
    const linked = await AuthIdentity.findOne({
      provider,
      providerSubject: identity.subject,
    });
    if (!linked)
      return res
        .status(403)
        .send(
          "This provider account is not linked to an ExamGuard account. Sign in with your password first and ask an administrator to link it.",
        );
    const user = await User.findById(linked.userId);
    const membership =
      user &&
      (await Membership.findOne({ userId: user._id, active: true }).populate(
        "organizationId",
      ));
    if (!user || !membership)
      return res
        .status(403)
        .send("No active ExamGuard membership exists for this account.");
    const org = membership.organizationId as unknown as {
      id: string;
      name: string;
    };
    const payload = Buffer.from(
      JSON.stringify({
        token: signToken(user.id),
        user: { id: user.id, name: user.name, email: user.email },
        organization: { id: org.id, name: org.name },
        role: membership.role,
      }),
    ).toString("base64url");
    res.redirect(
      303,
      `${config.CLIENT_URL.replace(/\/$/, "")}/login?oauth=${payload}`,
    );
  } catch {
    res
      .status(400)
      .send(
        "We could not complete provider sign-in. Verify the provider configuration and try again.",
      );
  }
});
app.get("/api/public/institutions/regions", directoryLimiter, (req, res) => {
  const countryCode =
    typeof req.query.countryCode === "string" ? req.query.countryCode : "";
  if (!/^[A-Za-z]{2}$/.test(countryCode))
    return res
      .status(400)
      .json({ error: "A two-letter country code is required" });
  res.json({
    countryCode: countryCode.toUpperCase(),
    regions: regionsForCountry(countryCode),
  });
});
app.get(
  "/api/public/institutions/search",
  directoryLimiter,
  async (req, res) => {
    const country =
      typeof req.query.country === "string" ? req.query.country.trim() : "";
    const name =
      typeof req.query.name === "string" ? req.query.name.trim() : "";
    if (country.length < 2 || name.length < 2)
      return res
        .status(400)
        .json({
          error: "Country and a two-character institution search are required",
        });
    try {
      res.json({
        source: "hipolabs",
        results: await searchDirectory(country, name),
      });
    } catch {
      res
        .status(503)
        .json({
          error:
            "The public institution directory could not be reached after retrying. You can submit an institution review request below; this does not verify or create an institution.",
        });
    }
  },
);
app.post(
  "/api/public/institution-requests",
  directoryLimiter,
  async (req, res, next) => {
    try {
      const data = z
        .object({
          name: z.string().min(2).max(200),
          countryCode: z.string().regex(/^[A-Za-z]{2}$/),
          region: z.string().max(120).optional(),
          website: z.string().url().optional(),
          details: z.string().max(2000).optional(),
          requesterEmail: z.string().email(),
        })
        .parse(req.body);
      const request = await InstitutionRequest.create({
        ...data,
        countryCode: data.countryCode.toUpperCase(),
      });
      res.status(201).json({ reference: request.id, status: request.status });
    } catch (error) {
      if ((error as { code?: number }).code === 11000)
        return res
          .status(409)
          .json({ error: "A matching institution request already exists" });
      next(error);
    }
  },
);
app.post("/api/auth/register", async (req, res, next) => {
  try {
    const data = registration.parse(req.body);
    if (!passwordPolicy(data.password))
      return res
        .status(400)
        .json({
          error:
            "Password must contain upper and lower case letters, a number, and be at least 10 characters.",
        });
    const exists = await User.exists({ email: data.email });
    if (exists)
      return res.status(409).json({ error: "Email already registered" });
    const slug =
      data.organizationName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") +
      "-" +
      Math.random().toString(36).slice(2, 6);
    const user = await User.create({
      name: data.name,
      email: data.email,
      passwordHash: await bcrypt.hash(data.password, 12),
    });
    const organization = await Organization.create({
      name: data.organizationName,
      slug,
    });
    await Membership.create({
      userId: user._id,
      organizationId: organization._id,
      role: "institute_admin",
    });
    res
      .status(201)
      .json({
        token: signToken(String(user._id)),
        user: { id: user.id, name: user.name, email: user.email },
        organization: { id: organization.id, name: organization.name },
        role: "institute_admin",
      });
  } catch (error) {
    next(error);
  }
});
app.post("/api/auth/login", async (req, res, next) => {
  try {
    const data = credentials.parse(req.body);
    const user = await User.findOne({ email: data.email });
    if (!user || !(await bcrypt.compare(data.password, user.passwordHash)))
      return res.status(401).json({ error: "Invalid email or password" });
    const membership = await Membership.findOne({
      userId: user._id,
      active: true,
    }).populate("organizationId");
    if (!membership)
      return res
        .status(403)
        .json({ error: "No active organization membership" });
    const org = membership.organizationId as unknown as {
      id: string;
      name: string;
    };
    res.json({
      token: signToken(user.id),
      user: { id: user.id, name: user.name, email: user.email },
      organization: { id: org.id, name: org.name },
      role: membership.role,
    });
  } catch (error) {
    next(error);
  }
});
app.post(
  "/api/auth/password-reset/request",
  passwordResetLimiter,
  async (req, res, next) => {
    try {
      const { email } = resetRequest.parse(req.body);
      const generic = {
        message:
          "If an account exists, password recovery instructions will be sent.",
      };
      const user = await User.findOne({ email: email.toLowerCase() });
      if (
        !user ||
        process.env.EMAIL_PROVIDER !== "webhook" ||
        !process.env.EMAIL_URL ||
        !process.env.EMAIL_FROM
      )
        return res.status(202).json(generic);
      const token = createResetToken();
      const tokenHash = hashResetToken(token);
      const config = loadConfig();
      const resetLink = `${config.APP_BASE_URL.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
      await PasswordResetToken.deleteMany({ userId: user._id, usedAt: null });
      const reset = await PasswordResetToken.create({
        userId: user._id,
        tokenHash,
        expiresAt: new Date(Date.now() + 15 * 60_000),
      });
      try {
        await sendPasswordResetEmail(user.email, resetLink);
      } catch {
        await PasswordResetToken.deleteOne({ _id: reset._id });
      }
      const membership = await Membership.findOne({
        userId: user._id,
        active: true,
      });
      if (membership)
        await audit(
          String(membership.organizationId),
          user.id,
          "password_reset.requested",
          "User",
          user.id,
        );
      res.status(202).json(generic);
    } catch (error) {
      next(error);
    }
  },
);
app.post(
  "/api/auth/password-reset/confirm",
  passwordResetLimiter,
  async (req, res, next) => {
    try {
      const data = resetPassword.parse(req.body);
      if (!passwordPolicy(data.password))
        return res
          .status(400)
          .json({
            error:
              "Password must contain upper and lower case letters, a number, and be at least 10 characters.",
          });
      const tokenHash = hashResetToken(data.token);
      const reset = await PasswordResetToken.findOneAndUpdate(
        { tokenHash, usedAt: null, expiresAt: { $gt: new Date() } },
        { usedAt: new Date() },
        { new: true },
      );
      if (!reset)
        return res
          .status(400)
          .json({
            error:
              "This password reset link is invalid, expired, or already used.",
          });
      await User.updateOne(
        { _id: reset.userId },
        { passwordHash: await bcrypt.hash(data.password, 12) },
      );
      const membership = await Membership.findOne({
        userId: reset.userId,
        active: true,
      });
      if (membership)
        await audit(
          String(membership.organizationId),
          String(reset.userId),
          "password_reset.completed",
          "User",
          String(reset.userId),
        );
      res.json({
        message: "Password updated. Sign in with your new password.",
      });
    } catch (error) {
      next(error);
    }
  },
);
app.get(
  "/api/organizations/:organizationId/dashboard",
  authenticate,
  authorize("institute_admin", "teacher", "proctor"),
  async (req: AuthRequest, res) => {
    const organizationId = req.auth!.organizationId!;
    const [
      exams,
      candidates,
      verificationPending,
      incidents,
      activeSessions,
      pendingExplanations,
    ] = await Promise.all([
      Exam.countDocuments({ organizationId }),
      Candidate.countDocuments({ organizationId }),
      VerificationRequest.countDocuments({
        organizationId,
        status: { $in: ["submitted", "resubmission_required"] },
      }),
      Incident.find({ organizationId, status: "open" })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      ExamAttempt.countDocuments({ organizationId, status: "in_progress" }),
      StudentExplanation.countDocuments({
        organizationId,
        status: { $in: ["requested", "follow_up"] },
      }),
    ]);
    res.json({
      stats: {
        exams,
        candidates,
        verificationPending,
        openIncidents: incidents.length,
        activeSessions,
        pendingExplanations,
      },
      incidents,
    });
  },
);
app.get("/api/system/status", authenticate, async (_req: AuthRequest, res) =>
  res.json({
    api: "healthy",
    storage: storageConfigured() ? "configured_not_verified" : "unconfigured",
    aiService: process.env.AI_SERVICE_URL
      ? "configured_not_verified"
      : "unconfigured",
    email: "unavailable_no_adapter",
  }),
);
app.get(
  "/api/organizations/:organizationId/exams",
  authenticate,
  authorize("institute_admin", "teacher", "proctor"),
  async (req: AuthRequest, res) =>
    res.json(
      await Exam.find(tenantFilter(req.auth!.organizationId!))
        .sort({ createdAt: -1 })
        .lean(),
    ),
);
app.get(
  "/api/organizations/:organizationId/exams/:examId",
  authenticate,
  authorize("institute_admin", "teacher"),
  async (req: AuthRequest, res) => {
    const exam = await Exam.findOne({
      _id: req.params.examId,
      organizationId: req.auth!.organizationId,
    });
    if (!exam) return res.status(404).json({ error: "Exam not found" });
    res.json(exam);
  },
);
app.post(
  "/api/organizations/:organizationId/exams",
  authenticate,
  authorize("institute_admin", "teacher"),
  async (req: AuthRequest, res, next) => {
    try {
      const data = examInput.parse(req.body);
      const { accessCode, ...examData } = data;
      const exam = await Exam.create({
        ...examData,
        accessCodeHash: accessCode
          ? await bcrypt.hash(accessCode, 12)
          : undefined,
        startsAt: data.startsAt ? new Date(data.startsAt) : undefined,
        endsAt: data.endsAt ? new Date(data.endsAt) : undefined,
        organizationId: req.auth!.organizationId,
        createdBy: req.auth!.userId,
      });
      await audit(
        req.auth!.organizationId!,
        req.auth!.userId,
        "exam.created",
        "Exam",
        exam.id,
      );
      res.status(201).json(exam);
    } catch (error) {
      next(error);
    }
  },
);
app.put(
  "/api/organizations/:organizationId/exams/:examId",
  authenticate,
  authorize("institute_admin", "teacher"),
  async (req: AuthRequest, res, next) => {
    try {
      const data = examInput.parse(req.body);
      const { accessCode, ...examData } = data;
      const update: Record<string, unknown> = {
        ...examData,
        startsAt: data.startsAt ? new Date(data.startsAt) : undefined,
        endsAt: data.endsAt ? new Date(data.endsAt) : undefined,
      };
      if (accessCode) update.accessCodeHash = await bcrypt.hash(accessCode, 12);
      const exam = await Exam.findOneAndUpdate(
        {
          _id: req.params.examId,
          organizationId: req.auth!.organizationId,
          status: "draft",
        },
        update,
        { new: true, runValidators: true },
      );
      if (!exam)
        return res.status(404).json({ error: "Editable draft exam not found" });
      await audit(
        req.auth!.organizationId!,
        req.auth!.userId,
        "exam.updated",
        "Exam",
        exam.id,
      );
      res.json(exam);
    } catch (error) {
      next(error);
    }
  },
);
app.get(
  "/api/organizations/:organizationId/candidates",
  authenticate,
  authorize("institute_admin", "teacher", "proctor"),
  async (req: AuthRequest, res) =>
    res.json(
      await Candidate.find({ organizationId: req.auth!.organizationId })
        .sort({ name: 1 })
        .lean(),
    ),
);
app.get(
  "/api/organizations/:organizationId/candidates/:candidateId",
  authenticate,
  authorize("institute_admin", "teacher", "proctor"),
  async (req: AuthRequest, res) => {
    const organizationId = req.auth!.organizationId!;
    const candidate = await Candidate.findOne({
      _id: req.params.candidateId,
      organizationId,
    })
      .select("name email phone externalId emailVerifiedAt phoneVerifiedAt userId")
      .lean();
    if (!candidate)
      return res.status(404).json({ error: "Candidate not found" });
    const [verification, assignments, attempts, grades] = await Promise.all([
      VerificationRequest.findOne({ organizationId, candidateId: candidate._id })
        .select("status submittedAt reviewedAt rejectionReason")
        .lean(),
      ExamAssignment.find({ organizationId, candidateId: candidate._id })
        .populate("examId", "title status startsAt endsAt durationMinutes")
        .lean(),
      ExamAttempt.find({ organizationId, candidateId: candidate._id })
        .select("examId status startedAt submittedAt deadlineAt receiptCode")
        .lean(),
      Grade.find({ organizationId, candidateId: candidate._id })
        .select("examId totalMarks maxMarks status publishedAt")
        .lean(),
    ]);
    res.json({
      candidate: {
        id: String(candidate._id), name: candidate.name, email: candidate.email,
        phone: candidate.phone, externalId: candidate.externalId,
        emailVerifiedAt: candidate.emailVerifiedAt, phoneVerifiedAt: candidate.phoneVerifiedAt,
        accountLinked: Boolean(candidate.userId),
      },
      verification: verification ?? { status: "not_submitted" },
      assessments: assignments.map((assignment) => {
        const exam = assignment.examId as unknown as { _id?: unknown };
        const examId = String(exam?._id ?? assignment.examId);
        return {
          exam: assignment.examId,
          attempt: attempts.find((attempt) => String(attempt.examId) === examId),
          grade: grades.find((grade) => String(grade.examId) === examId),
        };
      }),
    });
  },
);
app.post(
  "/api/organizations/:organizationId/candidates",
  authenticate,
  authorize("institute_admin", "teacher"),
  async (req: AuthRequest, res, next) => {
    try {
      const data = z
        .object({
          name: z.string().min(2),
          email: z.string().email(),
          initialPassword: z.string().min(10),
          phone: z.string().optional(),
        })
        .parse(req.body);
      if (!passwordPolicy(data.initialPassword))
        return res.status(400).json({
          error:
            "Initial password must contain upper and lower case letters, a number, and be at least 10 characters.",
        });
      const organizationId = req.auth!.organizationId!;
      const normalizedEmail = data.email.toLowerCase();
      const [existingCandidate, existingUser] = await Promise.all([
        Candidate.exists({ organizationId, email: normalizedEmail }),
        User.exists({ email: normalizedEmail }),
      ]);
      if (existingCandidate)
        return res.status(409).json({ error: "A candidate with this email already exists in this organization." });
      if (existingUser)
        return res.status(409).json({ error: "This email already has an ExamGuard account. Use the existing account or the password-recovery flow; an administrator cannot replace its password here." });
      const user = await User.create({
        name: data.name,
        email: normalizedEmail,
        passwordHash: await bcrypt.hash(data.initialPassword, 12),
      });
      await Membership.create({
        userId: user._id,
        organizationId,
        role: "student",
      });
      const candidate = await Candidate.create({
        name: data.name,
        email: normalizedEmail,
        phone: data.phone,
        userId: user._id,
        organizationId,
      });
      await audit(
        req.auth!.organizationId!,
        req.auth!.userId,
        "candidate.created",
        "Candidate",
        candidate.id,
      );
      res.status(201).json({
        id: candidate.id,
        name: candidate.name,
        email: candidate.email,
        accountCreated: true,
      });
    } catch (e) {
      next(e);
    }
  },
);
app.post(
  "/api/organizations/:organizationId/exams/:examId/publish",
  authenticate,
  authorize("institute_admin", "teacher"),
  async (req: AuthRequest, res) => {
    const draft = await Exam.findOne({
      _id: req.params.examId,
      organizationId: req.auth!.organizationId,
      status: "draft",
    });
    if (!draft) return res.status(404).json({ error: "Draft exam not found" });
    const questionCount = await Question.countDocuments({
      organizationId: req.auth!.organizationId,
      examId: draft._id,
    });
    if (!questionCount)
      return res
        .status(400)
        .json({
          error: "Add at least one question before publishing this exam",
        });
    const exam = await Exam.findByIdAndUpdate(
      draft._id,
      {
        status:
          draft.startsAt && draft.startsAt > new Date()
            ? "scheduled"
            : "published",
      },
      { new: true },
    );
    await audit(
      req.auth!.organizationId!,
      req.auth!.userId,
      "exam.published",
      "Exam",
      exam!.id,
      { questionCount },
    );
    res.json(exam);
  },
);
app.post(
  "/api/organizations/:organizationId/exams/:examId/questions",
  authenticate,
  authorize("institute_admin", "teacher"),
  async (req: AuthRequest, res, next) => {
    try {
      const data = questionInput.parse(req.body);
      const exam = await Exam.exists({
        _id: req.params.examId,
        organizationId: req.auth!.organizationId,
        status: "draft",
      });
      if (!exam) return res.status(404).json({ error: "Draft exam not found" });
      const q = await Question.create({
        ...data,
        organizationId: req.auth!.organizationId,
        examId: req.params.examId,
        position: await Question.countDocuments({ examId: req.params.examId }),
      });
      res.status(201).json(q);
    } catch (e) {
      next(e);
    }
  },
);
app.delete(
  "/api/organizations/:organizationId/exams/:examId/questions/:questionId",
  authenticate,
  authorize("institute_admin", "teacher"),
  async (req: AuthRequest, res) => {
    const exam = await Exam.exists({
      _id: req.params.examId,
      organizationId: req.auth!.organizationId,
      status: "draft",
    });
    if (!exam)
      return res.status(404).json({ error: "Editable draft exam not found" });
    const question = await Question.findOneAndDelete({
      _id: req.params.questionId,
      organizationId: req.auth!.organizationId,
      examId: req.params.examId,
    });
    if (!question)
      return res
        .status(404)
        .json({ error: "Editable draft question not found" });
    await audit(
      req.auth!.organizationId!,
      req.auth!.userId,
      "exam.question_removed",
      "Question",
      question.id,
    );
    res.status(204).end();
  },
);
app.get(
  "/api/organizations/:organizationId/exams/:examId/questions",
  authenticate,
  authorize("institute_admin", "teacher"),
  async (req: AuthRequest, res) =>
    res.json(
      await Question.find({
        organizationId: req.auth!.organizationId,
        examId: req.params.examId,
      })
        .sort({ position: 1 })
        .lean(),
    ),
);
app.get(
  "/api/organizations/:organizationId/question-banks",
  authenticate,
  authorize("institute_admin", "teacher"),
  async (req: AuthRequest, res) =>
    res.json(
      await QuestionBank.find({ organizationId: req.auth!.organizationId })
        .sort({ name: 1 })
        .lean(),
    ),
);
app.post(
  "/api/organizations/:organizationId/question-banks",
  authenticate,
  authorize("institute_admin", "teacher"),
  async (req: AuthRequest, res, next) => {
    try {
      const data = z
        .object({
          name: z.string().min(2).max(160),
          description: z.string().max(1000).optional(),
        })
        .parse(req.body);
      const bank = await QuestionBank.create({
        ...data,
        organizationId: req.auth!.organizationId,
        createdBy: req.auth!.userId,
      });
      await audit(
        req.auth!.organizationId!,
        req.auth!.userId,
        "question_bank.created",
        "QuestionBank",
        bank.id,
      );
      res.status(201).json(bank);
    } catch (error) {
      next(error);
    }
  },
);
app.get(
  "/api/organizations/:organizationId/question-banks/:bankId/questions",
  authenticate,
  authorize("institute_admin", "teacher"),
  async (req: AuthRequest, res) =>
    res.json(
      await Question.find({
        organizationId: req.auth!.organizationId,
        bankId: req.params.bankId,
        examId: { $exists: false },
      })
        .sort({ createdAt: -1 })
        .lean(),
    ),
);
app.post(
  "/api/organizations/:organizationId/question-banks/:bankId/questions",
  authenticate,
  authorize("institute_admin", "teacher"),
  async (req: AuthRequest, res, next) => {
    try {
      const data = questionInput.parse(req.body);
      const bank = await QuestionBank.exists({
        _id: req.params.bankId,
        organizationId: req.auth!.organizationId,
      });
      if (!bank)
        return res.status(404).json({ error: "Question bank not found" });
      const question = await Question.create({
        ...data,
        organizationId: req.auth!.organizationId,
        bankId: req.params.bankId,
      });
      await audit(
        req.auth!.organizationId!,
        req.auth!.userId,
        "question_bank.question_created",
        "Question",
        question.id,
      );
      res.status(201).json(question);
    } catch (error) {
      next(error);
    }
  },
);
app.put(
  "/api/organizations/:organizationId/question-banks/:bankId/questions/:questionId",
  authenticate,
  authorize("institute_admin", "teacher"),
  async (req: AuthRequest, res, next) => {
    try {
      const data = questionInput.parse(req.body);
      const question = await Question.findOneAndUpdate(
        {
          _id: req.params.questionId,
          organizationId: req.auth!.organizationId,
          bankId: req.params.bankId,
          examId: { $exists: false },
        },
        data,
        { new: true, runValidators: true },
      );
      if (!question)
        return res
          .status(404)
          .json({ error: "Editable question-bank question not found" });
      await audit(
        req.auth!.organizationId!,
        req.auth!.userId,
        "question_bank.question_updated",
        "Question",
        question.id,
      );
      res.json(question);
    } catch (error) {
      next(error);
    }
  },
);
app.post(
  "/api/organizations/:organizationId/exams/:examId/questions/from-bank/:questionId",
  authenticate,
  authorize("institute_admin", "teacher"),
  async (req: AuthRequest, res) => {
    const exam = await Exam.exists({
      _id: req.params.examId,
      organizationId: req.auth!.organizationId,
      status: "draft",
    });
    const source = await Question.findOne({
      _id: req.params.questionId,
      organizationId: req.auth!.organizationId,
      bankId: { $exists: true },
      examId: { $exists: false },
    }).lean();
    if (!exam || !source)
      return res
        .status(404)
        .json({ error: "Draft exam or question-bank question not found" });
    const question = await Question.create({
      organizationId: req.auth!.organizationId,
      examId: req.params.examId,
      type: source.type,
      prompt: source.prompt,
      options: source.options,
      correctAnswer: source.correctAnswer,
      marks: source.marks,
      negativeMarks: source.negativeMarks,
      position: await Question.countDocuments({ examId: req.params.examId }),
    });
    await audit(
      req.auth!.organizationId!,
      req.auth!.userId,
      "exam.question_added_from_bank",
      "Question",
      question.id,
      { sourceQuestionId: source._id },
    );
    res.status(201).json(question);
  },
);
app.post(
  "/api/organizations/:organizationId/exams/:examId/assignments",
  authenticate,
  authorize("institute_admin", "teacher"),
  async (req: AuthRequest, res, next) => {
    try {
      const data = z.object({ candidateId: z.string() }).parse(req.body);
      const candidate = await Candidate.exists({
        _id: data.candidateId,
        organizationId: req.auth!.organizationId,
      });
      const exam = await Exam.exists({
        _id: req.params.examId,
        organizationId: req.auth!.organizationId,
        status: { $in: ["published", "scheduled", "live"] },
      });
      if (!candidate || !exam)
        return res.status(404).json({ error: "Candidate not found or assessment is not published" });
      const assignment = await ExamAssignment.findOneAndUpdate(
        {
          organizationId: req.auth!.organizationId,
          examId: req.params.examId,
          candidateId: data.candidateId,
        },
        {},
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      res.status(201).json(assignment);
    } catch (e) {
      next(e);
    }
  },
);
app.post(
  "/api/organizations/:organizationId/candidates/:candidateId/verification",
  authenticate,
  async (req: AuthRequest, res) => {
    const organizationId = String(req.params.organizationId);
    const candidate = await Candidate.findOne({
      _id: req.params.candidateId,
      organizationId,
      userId: req.auth!.userId,
    });
    if (!candidate)
      return res.status(403).json({ error: "Candidate access required" });
    const verification = await VerificationRequest.findOneAndUpdate(
      { organizationId, candidateId: candidate._id },
      {
        status: "submitted",
        submittedAt: new Date(),
        rejectionReason: undefined,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await audit(
      organizationId,
      req.auth!.userId,
      "verification.submitted",
      "VerificationRequest",
      verification.id,
    );
    res.json(verification);
  },
);
app.get(
  "/api/student/dashboard",
  authenticate,
  async (req: AuthRequest, res) => {
    const memberships = await Membership.find({
      userId: req.auth!.userId,
      active: true,
    }).select("organizationId").lean();
    const candidate = await Candidate.findOne({
      userId: req.auth!.userId,
      organizationId: { $in: memberships.map((membership) => membership.organizationId) },
    }).lean();
    if (!candidate)
      return res.status(403).json({ error: "Candidate access required" });
    const organizationId = candidate.organizationId;
    const assignments = await ExamAssignment.find({
      organizationId,
      candidateId: candidate._id,
    })
      .populate("examId", "title status startsAt endsAt durationMinutes instructions")
      .lean();
    const attempts = await ExamAttempt.find({
      organizationId,
      candidateId: candidate._id,
    })
      .select("examId status startedAt submittedAt deadlineAt receiptCode")
      .lean();
    const grades = await Grade.find({
      organizationId,
      candidateId: candidate._id,
      status: "published",
    })
      .select("examId totalMarks maxMarks feedback publishedAt")
      .lean();
    res.json({
      candidate: { id: String(candidate._id), name: candidate.name },
      assignments: assignments.map((assignment) => {
        const exam = assignment.examId as unknown as { _id?: unknown };
        const examId = String(exam?._id ?? assignment.examId);
        return {
          id: String(assignment._id),
          exam: assignment.examId,
          attempt: attempts.find((attempt) => String(attempt.examId) === examId),
          grade: grades.find((grade) => String(grade.examId) === examId),
        };
      }),
    });
  },
);
app.post(
  "/api/organizations/:organizationId/candidates/:candidateId/documents/:kind",
  authenticate,
  upload.single("file"),
  async (req: AuthRequest, res, next) => {
    try {
      const organizationId = String(req.params.organizationId);
      const kind = String(req.params.kind);
      const candidate = await Candidate.findOne({
        _id: req.params.candidateId,
        organizationId,
        userId: req.auth!.userId,
      });
      if (!candidate || !req.file || !["photo", "idDocument"].includes(kind))
        return res.status(403).json({ error: "Authorized file required" });
      const key = `organizations/${organizationId}/candidates/${candidate.id}/${kind}-${Date.now()}`;
      await putPrivateDocument(key, req.file.buffer, req.file.mimetype);
      const verification = await VerificationRequest.findOneAndUpdate(
        { organizationId, candidateId: candidate._id },
        {
          [kind === "photo" ? "profilePhoto" : "idDocument"]: key,
          status: "draft",
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      await audit(
        organizationId,
        req.auth!.userId,
        "verification.document_uploaded",
        "VerificationRequest",
        verification.id,
        { kind },
      );
      res.json({ status: verification.status });
    } catch (e) {
      next(e);
    }
  },
);
app.get(
  "/api/organizations/:organizationId/verifications",
  authenticate,
  authorize("institute_admin", "teacher", "proctor"),
  async (req: AuthRequest, res) =>
    res.json(
      await VerificationRequest.find({
        organizationId: req.auth!.organizationId,
      })
        .populate("candidateId", "name email phone")
        .lean(),
    ),
);
app.post(
  "/api/organizations/:organizationId/verifications/:id/review",
  authenticate,
  authorize("institute_admin", "proctor"),
  async (req: AuthRequest, res, next) => {
    try {
      const data = z
        .object({
          approved: z.boolean(),
          reason: z.string().max(1000).optional(),
        })
        .parse(req.body);
      if (!data.approved && !data.reason)
        return res
          .status(400)
          .json({ error: "A rejection reason is required" });
      const verification = await VerificationRequest.findOneAndUpdate(
        {
          _id: req.params.id,
          organizationId: req.auth!.organizationId,
          status: { $in: ["submitted", "resubmission_required"] },
        },
        {
          status: data.approved ? "approved" : "rejected",
          rejectionReason: data.approved ? undefined : data.reason,
          reviewedAt: new Date(),
          reviewedBy: req.auth!.userId,
        },
        { new: true },
      );
      if (!verification)
        return res.status(404).json({ error: "Verification not found" });
      await audit(
        req.auth!.organizationId!,
        req.auth!.userId,
        data.approved ? "verification.approved" : "verification.rejected",
        "VerificationRequest",
        verification.id,
        { reason: data.reason },
      );
      res.json(verification);
    } catch (e) {
      next(e);
    }
  },
);
app.post(
  "/api/student/organizations/:organizationId/exams/:examId/start",
  authenticate,
  async (req: AuthRequest, res) => {
    const organizationId = String(req.params.organizationId);
    const { accessCode } = req.body as { accessCode?: string };
    const candidate = await Candidate.findOne({
      organizationId,
      userId: req.auth!.userId,
    });
    const exam = await Exam.findOne({
      _id: req.params.examId,
      organizationId,
      status: { $in: ["published", "scheduled", "live"] },
    });
    if (!candidate || !exam)
      return res
        .status(403)
        .json({ error: "Authorized candidate and published exam required" });
    const assignment = await ExamAssignment.exists({
      organizationId: exam.organizationId,
      examId: exam._id,
      candidateId: candidate._id,
    });
    if (
      !assignment ||
      !canStartExam(
        new Date(),
        exam.startsAt || undefined,
        exam.endsAt || undefined,
      )
    )
      return res
        .status(403)
        .json({ error: "This exam is not currently available" });
    if (exam.requireVerification) {
      const verification = await VerificationRequest.exists({
        organizationId: exam.organizationId,
        candidateId: candidate._id,
        status: "approved",
      });
      if (!verification)
        return res
          .status(403)
          .json({ error: "Identity verification is required before starting" });
    }
    if (
      exam.accessCodeHash &&
      !(accessCode && (await bcrypt.compare(accessCode, exam.accessCodeHash)))
    )
      return res.status(403).json({ error: "Valid access code required" });
    let attempt = await ExamAttempt.findOne({
      examId: exam._id,
      candidateId: candidate._id,
    });
    if (!attempt) {
      const questions = await Question.find({
        organizationId: exam.organizationId,
        examId: exam._id,
      })
        .select("_id")
        .lean();
      const order = questions.map((q) => String(q._id));
      if (exam.randomizeQuestions) order.sort(() => Math.random() - 0.5);
      attempt = await ExamAttempt.create({
        organizationId: exam.organizationId,
        examId: exam._id,
        candidateId: candidate._id,
        userId: req.auth!.userId,
        startedAt: new Date(),
        deadlineAt: deadlineFor(
          new Date(),
          exam.durationMinutes,
          exam.endsAt || undefined,
        ),
        questionOrder: order,
      });
      await audit(
        organizationId,
        req.auth!.userId,
        "attempt.started",
        "ExamAttempt",
        attempt.id,
      );
    }
    if (!isAttemptOpen(attempt.status, attempt.deadlineAt))
      return res.status(409).json({ error: "Attempt is no longer open" });
    const questionDocs = await Question.find({
      _id: { $in: attempt.questionOrder },
      organizationId: exam.organizationId,
    }).lean();
    const ordered = attempt.questionOrder
      .map((id) => questionDocs.find((q) => String(q._id) === id))
      .filter(Boolean)
      .map((q) => ({
        _id: q!._id,
        type: q!.type,
        prompt: q!.prompt,
        options: exam.randomizeOptions
          ? [...q!.options].sort(() => Math.random() - 0.5)
          : q!.options,
        marks: q!.marks,
      }));
    const answers = await AttemptAnswer.find({ attemptId: attempt._id }).lean();
    res.json({
      attempt: {
        id: attempt.id,
        candidateId: candidate.id,
        examId: String(exam._id),
        deadlineAt: attempt.deadlineAt,
        status: attempt.status,
      },
      exam: { title: exam.title, instructions: exam.instructions },
      questions: ordered,
      answers,
    });
  },
);
app.put(
  "/api/student/attempts/:attemptId/answers/:questionId",
  authenticate,
  async (req: AuthRequest, res, next) => {
    try {
      const attempt = await ExamAttempt.findOne({
        _id: req.params.attemptId,
        userId: req.auth!.userId,
      });
      if (!attempt || !isAttemptOpen(attempt.status, attempt.deadlineAt))
        return res.status(409).json({ error: "Attempt is closed" });
      const question = await Question.findOne({
        _id: req.params.questionId,
        examId: attempt.examId,
        organizationId: attempt.organizationId,
      })
        .select("type options")
        .lean();
      if (!question)
        return res.status(404).json({ error: "Question not found" });
      const value = validateAnswerValue(question, req.body.value);
      const answer = await AttemptAnswer.findOneAndUpdate(
        { attemptId: attempt._id, questionId: req.params.questionId },
        {
          organizationId: attempt.organizationId,
          value,
          savedAt: new Date(),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      res.json({ savedAt: answer.savedAt });
    } catch (e) {
      next(e);
    }
  },
);
app.post(
  "/api/student/attempts/:attemptId/submit",
  authenticate,
  async (req: AuthRequest, res) => {
    const attempt = await ExamAttempt.findOne({
      _id: req.params.attemptId,
      userId: req.auth!.userId,
    });
    if (!attempt) return res.status(404).json({ error: "Attempt not found" });
    if (attempt.status === "submitted")
      return res
        .status(409)
        .json({ error: "Already submitted", receiptCode: attempt.receiptCode });
    if (attempt.status === "paused" || attempt.status === "terminated")
      return res
        .status(409)
        .json({
          error: `Attempt is ${attempt.status} and cannot be submitted by the candidate`,
        });
    const receiptCode = `EG-${attempt.id.slice(-6).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
    const status = new Date() >= attempt.deadlineAt ? "expired" : "submitted";
    attempt.status = status;
    attempt.submittedAt = new Date();
    attempt.receiptCode = receiptCode;
    await attempt.save();
    await audit(
      String(attempt.organizationId),
      req.auth!.userId,
      "attempt.submitted",
      "ExamAttempt",
      attempt.id,
      { status, receiptCode },
    );
    res.json({ status, receiptCode, submittedAt: attempt.submittedAt });
  },
);
app.get(
  "/api/organizations/:organizationId/proctoring/config",
  authenticate,
  authorize("institute_admin", "teacher", "proctor"),
  async (req: AuthRequest, res) =>
    res.json(
      await ProctoringConfig.findOneAndUpdate(
        { organizationId: req.auth!.organizationId },
        {},
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ),
    ),
);
app.post(
  "/api/organizations/:organizationId/proctoring/events",
  authenticate,
  async (req: AuthRequest, res, next) => {
    try {
      const data = proctorEventInput.parse(req.body);
      const organizationId = String(req.params.organizationId);
      const candidate = await Candidate.findOne({
        _id: data.candidateId,
        organizationId,
        userId: req.auth!.userId,
      });
      const attempt = await ExamAttempt.findOne({
        _id: data.attemptId,
        organizationId,
        candidateId: data.candidateId,
        examId: data.examId,
        userId: req.auth!.userId,
        status: "in_progress",
      });
      const exam = await Exam.findOne({ _id: data.examId, organizationId });
      if (!candidate || !attempt || !exam)
        return res
          .status(403)
          .json({ error: "An active authorized attempt is required" });
      const policy = exam.interventionPolicy ?? {
        windowSeconds: 300,
        warningAt: 1,
        pauseAt: 3,
        terminateAt: 5,
        automaticTerminationEnabled: false,
        fullscreenRequired: false,
      };
      const occurredAt = new Date();
      const config = await ProctoringConfig.findOneAndUpdate(
        { organizationId },
        {},
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      const fingerprint = fingerprintFor(
        organizationId,
        candidate.id,
        data.type,
        dedupeWindow(occurredAt, config.cooldownSeconds),
      );
      if (await ProctoringEvent.exists({ organizationId, fingerprint }))
        return res.status(202).json({ deduplicated: true });
      const windowStart = new Date(
        occurredAt.getTime() - policy.windowSeconds * 1000,
      );
      const eventCount =
        (await ProctoringEvent.countDocuments({
          organizationId,
          attemptId: attempt._id,
          type: data.type,
          occurredAt: { $gte: windowStart },
        })) + 1;
      const action = interventionFor(policy, data.type, eventCount);
      const event = await ProctoringEvent.create({
        ...data,
        organizationId,
        occurredAt,
        fingerprint,
        warningCount: eventCount,
        policyAction: action,
      });
      const weight = Number(config.signalWeights.get(data.type) ?? 0);
      const priority = reviewPriority([{ type: data.type, weight }]);
      const incident = await Incident.create({
        organizationId,
        examId: data.examId,
        candidateId: candidate._id,
        sessionId: data.sessionId,
        eventIds: [event._id],
        type: data.type,
        severity:
          priority.score >= 30
            ? "high"
            : priority.score >= 15
              ? "medium"
              : "low",
        riskPriority: priority.score,
        contributingSignals: priority.contributingSignals.map((x) => ({
          ...x,
          eventId: event.id,
        })),
        details:
          action === "technical"
            ? `Technical event: ${data.type}`
            : `Automated signal: ${data.type}`,
      });
      if (action === "paused" || action === "terminated") {
        const update =
          action === "paused"
            ? {
                status: "paused",
                pausedAt: occurredAt,
                interventionReason: `Repeated ${data.type}`,
              }
            : {
                status: "terminated",
                terminatedAt: occurredAt,
                interventionReason: `Policy threshold reached for ${data.type}`,
              };
        const changed = await ExamAttempt.findOneAndUpdate(
          { _id: attempt._id, status: "in_progress" },
          update,
          { new: true },
        );
        if (!changed)
          return res
            .status(409)
            .json({
              error:
                "Attempt state changed before intervention could be applied",
            });
        await audit(
          organizationId,
          req.auth!.userId,
          `attempt.${action}`,
          "ExamAttempt",
          attempt.id,
          { eventType: data.type, eventCount },
        );
      }
      await audit(
        organizationId,
        req.auth!.userId,
        "proctoring.event_recorded",
        "Incident",
        incident.id,
        { eventId: event.id, action, eventCount },
      );
      const broadcast = app.get("broadcast") as
        undefined | ((room: string, payload: unknown) => void);
      broadcast?.(`org:${organizationId}:exam:${data.examId}`, {
        incidentId: incident.id,
        attemptId: attempt.id,
        type: event.type,
        action,
        warningCount: eventCount,
        occurredAt: event.occurredAt,
      });
      res
        .status(201)
        .json({
          incidentId: incident.id,
          eventId: event.id,
          action,
          warningCount: eventCount,
          message:
            action === "warning"
              ? `Warning ${eventCount}: follow your examination rules to continue.`
              : action === "paused"
                ? "Your attempt has been paused pending reviewer action."
                : action === "terminated"
                  ? "Your attempt has been ended under the configured examination policy."
                  : undefined,
        });
    } catch (e) {
      next(e);
    }
  },
);
app.post(
  "/api/organizations/:organizationId/attempts/:attemptId/resume",
  authenticate,
  authorize("institute_admin", "proctor"),
  async (req: AuthRequest, res, next) => {
    try {
      const data = z
        .object({ reason: z.string().min(3).max(2000) })
        .parse(req.body);
      const attempt = await ExamAttempt.findOneAndUpdate(
        {
          _id: req.params.attemptId,
          organizationId: req.auth!.organizationId,
          status: "paused",
          deadlineAt: { $gt: new Date() },
        },
        {
          status: "in_progress",
          pausedAt: undefined,
          interventionReason: undefined,
        },
        { new: true },
      );
      if (!attempt)
        return res
          .status(404)
          .json({ error: "A resumable paused attempt was not found" });
      await audit(
        req.auth!.organizationId!,
        req.auth!.userId,
        "attempt.resumed",
        "ExamAttempt",
        attempt.id,
        { reason: data.reason },
      );
      res.json({ status: attempt.status, deadlineAt: attempt.deadlineAt });
    } catch (e) {
      next(e);
    }
  },
);
app.post(
  "/api/student/attempts/:attemptId/companion-pairing",
  authenticate,
  async (req: AuthRequest, res) => {
    const attempt = await ExamAttempt.findOne({
      _id: req.params.attemptId,
      userId: req.auth!.userId,
      status: "in_progress",
      deadlineAt: { $gt: new Date() },
    });
    if (!attempt)
      return res.status(409).json({
        error:
          "An active exam attempt is required before a companion can be paired.",
      });
    const candidate = await Candidate.findOne({
      _id: attempt.candidateId,
      organizationId: attempt.organizationId,
      userId: req.auth!.userId,
    });
    if (!candidate)
      return res.status(403).json({ error: "Candidate authorization is required" });
    const token = signCompanionToken({
      userId: req.auth!.userId,
      organizationId: String(attempt.organizationId),
      examId: String(attempt.examId),
      candidateId: candidate.id,
      attemptId: attempt.id,
    });
    await audit(
      String(attempt.organizationId),
      req.auth!.userId,
      "companion.pairing_issued",
      "ExamAttempt",
      attempt.id,
    );
    res.json({
      pairingToken: token,
      expiresInSeconds: 600,
      context: {
        organizationId: String(attempt.organizationId),
        examId: String(attempt.examId),
        candidateId: candidate.id,
        attemptId: attempt.id,
      },
    });
  },
);
app.get(
  "/api/student/companion-pairing",
  authenticateCompanion,
  async (req: AuthRequest, res) => {
    const companion = (req as AuthRequest & { companion: import("./auth.js").CompanionClaims }).companion;
    const attempt = await ExamAttempt.exists({
      _id: companion.attemptId,
      organizationId: companion.organizationId,
      examId: companion.examId,
      candidateId: companion.candidateId,
      userId: companion.userId,
      status: "in_progress",
      deadlineAt: { $gt: new Date() },
    });
    if (!attempt)
      return res.status(409).json({
        error:
          "This pairing is no longer active. Return to the active exam and generate a new pairing token.",
      });
    res.json({
      context: {
        organizationId: companion.organizationId,
        examId: companion.examId,
        candidateId: companion.candidateId,
        attemptId: companion.attemptId,
      },
      expiresAt: companion.expiresAt
        ? new Date(companion.expiresAt * 1000).toISOString()
        : undefined,
    });
  },
);
app.post(
  "/api/student/radio-observations",
  authenticateCompanion,
  radioObservationLimiter,
  async (req: AuthRequest, res, next) => {
    try {
      const data = radioObservationInput.parse(req.body);
      const companion = (req as AuthRequest & { companion: import("./auth.js").CompanionClaims }).companion;
      if (
        data.organizationId !== companion.organizationId ||
        data.examId !== companion.examId ||
        data.candidateId !== companion.candidateId ||
        data.attemptId !== companion.attemptId
      )
        return res.status(403).json({
          error: "Observation context does not match this companion pairing.",
        });
      const candidate = await Candidate.findOne({
        _id: data.candidateId,
        organizationId: companion.organizationId,
        userId: companion.userId,
      });
      const attempt =
        candidate &&
        (await ExamAttempt.findOne({
          _id: data.attemptId,
          organizationId: candidate.organizationId,
          candidateId: candidate._id,
          examId: data.examId,
          userId: companion.userId,
          status: "in_progress",
          deadlineAt: { $gt: new Date() },
        }));
      if (!candidate || !attempt)
        return res
          .status(403)
          .json({ error: "An active authorized attempt is required" });
      const organizationId = String(candidate.organizationId);
      const observedAt = new Date();
      const fingerprint = fingerprintFor(
        organizationId,
        attempt.id,
        `${data.source}:${data.kind}:${data.pseudonym ?? data.errorCode ?? "health"}`,
        dedupeWindow(observedAt, 30),
      );
      const limitations =
        data.source === "bluetooth_le"
          ? "BLE advertisements do not identify a device type; addresses may rotate and many phones do not advertise."
          : data.source === "wifi"
            ? "Wi-Fi scans observe access points, not nearby clients or every phone; a hotspot is not proof of a prohibited device."
            : "Scanner health is technical telemetry and is not evidence of student conduct.";
      const observation = await RadioObservation.findOneAndUpdate(
        { organizationId, fingerprint },
        { ...data, organizationId, observedAt, fingerprint, limitations },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      let signalId: string | undefined;
      if (data.kind === "advertisement" || data.kind === "access_point") {
        const windowStart = new Date(observedAt.getTime() - 5 * 60_000);
        const recent = await RadioObservation.find({
          organizationId,
          attemptId: attempt._id,
          source: data.source,
          kind: data.kind,
          observedAt: { $gte: windowStart },
        })
          .sort({ observedAt: -1 })
          .limit(3)
          .lean();
        if (recent.length >= 3) {
          const existing = await RadioCandidateSignal.findOne({
            organizationId,
            attemptId: attempt._id,
            rule: `repeated_${data.source}_observation`,
            status: "pending_review",
          });
          const signal =
            existing ??
            (await RadioCandidateSignal.create({
              organizationId,
              examId: data.examId,
              candidateId: candidate._id,
              attemptId: attempt._id,
              observationIds: recent.map((x) => x._id),
              rule: `repeated_${data.source}_observation`,
              label: "Repeated nearby radio observation — device type unknown",
            }));
          signalId = signal.id;
        }
      }
      await audit(
        organizationId,
        companion.userId,
        "radio.observation_recorded",
        "RadioObservation",
        observation.id,
        { source: data.source, kind: data.kind, signalId },
      );
      res
        .status(201)
        .json({
          observationId: observation.id,
          candidateSignalId: signalId,
          disposition:
            data.kind === "advertisement" || data.kind === "access_point"
              ? "recorded_for_possible_review"
              : "technical_status_recorded",
        });
    } catch (error) {
      next(error);
    }
  },
);
app.get(
  "/api/organizations/:organizationId/radio-observations",
  authenticate,
  authorize("institute_admin", "teacher", "proctor"),
  async (req: AuthRequest, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const [observations, signals] = await Promise.all([
      RadioObservation.find({ organizationId: req.auth!.organizationId })
        .sort({ observedAt: -1 })
        .limit(limit)
        .lean(),
      RadioCandidateSignal.find({ organizationId: req.auth!.organizationId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate("observationIds")
        .lean(),
    ]);
    res.json({ observations, signals });
  },
);
app.post(
  "/api/organizations/:organizationId/radio-signals/:signalId/review",
  authenticate,
  authorize("institute_admin", "teacher", "proctor"),
  async (req: AuthRequest, res, next) => {
    try {
      const data = z
        .object({
          status: z.enum([
            "reviewed_no_concern",
            "reviewed_concern_retained",
            "insufficient_evidence",
          ]),
          notes: z.string().min(3).max(2000),
        })
        .parse(req.body);
      const signal = await RadioCandidateSignal.findOneAndUpdate(
        { _id: req.params.signalId, organizationId: req.auth!.organizationId },
        { ...data, reviewerId: req.auth!.userId },
        { new: true },
      );
      if (!signal)
        return res
          .status(404)
          .json({ error: "Radio candidate signal not found" });
      await audit(
        req.auth!.organizationId!,
        req.auth!.userId,
        "radio.signal_reviewed",
        "RadioCandidateSignal",
        signal.id,
        data,
      );
      res.json(signal);
    } catch (error) {
      next(error);
    }
  },
);
app.get(
  "/api/organizations/:organizationId/incidents",
  authenticate,
  authorize("institute_admin", "teacher", "proctor"),
  async (req: AuthRequest, res) =>
    res.json(
      await Incident.find({ organizationId: req.auth!.organizationId })
        .sort({ createdAt: -1 })
        .populate("eventIds")
        .populate("candidateId", "name email")
        .populate("examId", "title")
        .lean(),
    ),
);
app.post(
  "/api/organizations/:organizationId/incidents/:incidentId/decision",
  authenticate,
  authorize("institute_admin", "proctor"),
  async (req: AuthRequest, res, next) => {
    try {
      const data = z
        .object({
          action: z.enum([
            "dismissed",
            "resolved",
            "escalated",
            "awaiting_student",
          ]),
          reason: z.string().min(3).max(2000),
          notes: z.string().max(4000).optional(),
        })
        .parse(req.body);
      const config = await ProctoringConfig.findOneAndUpdate(
        { organizationId: req.auth!.organizationId },
        {},
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      const update: Record<string, unknown> = {
        status: data.action,
        decisionReason: data.reason,
        reviewerNotes: data.notes,
      };
      if (data.action === "awaiting_student")
        update.explanationDeadlineAt = new Date(
          Date.now() + config.explanationDeadlineHours * 3600_000,
        );
      const incident = await Incident.findOneAndUpdate(
        {
          _id: req.params.incidentId,
          organizationId: req.auth!.organizationId,
        },
        update,
        { new: true },
      );
      if (!incident)
        return res.status(404).json({ error: "Incident not found" });
      if (data.action === "awaiting_student")
        await StudentExplanation.findOneAndUpdate(
          {
            organizationId: req.auth!.organizationId,
            incidentId: incident._id,
            candidateId: incident.candidateId,
          },
          { status: "requested" },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );
      await audit(
        req.auth!.organizationId!,
        req.auth!.userId,
        `incident.${data.action}`,
        "Incident",
        incident.id,
        { reason: data.reason, notes: data.notes },
      );
      res.json(incident);
    } catch (e) {
      next(e);
    }
  },
);
app.post(
  "/api/student/incidents/:incidentId/explanation",
  authenticate,
  async (req: AuthRequest, res, next) => {
    try {
      const data = z
        .object({ body: z.string().min(3).max(5000) })
        .parse(req.body);
      const incident = await Incident.findOne({
        _id: req.params.incidentId,
        status: "awaiting_student",
      });
      if (
        !incident ||
        (incident.explanationDeadlineAt &&
          incident.explanationDeadlineAt < new Date())
      )
        return res
          .status(403)
          .json({ error: "Explanation is unavailable or past its deadline" });
      const candidate = await Candidate.findOne({
        _id: incident.candidateId,
        organizationId: incident.organizationId,
        userId: req.auth!.userId,
      });
      if (!candidate)
        return res.status(403).json({ error: "Student access required" });
      const explanation = await StudentExplanation.findOneAndUpdate(
        {
          organizationId: incident.organizationId,
          incidentId: incident._id,
          candidateId: candidate._id,
        },
        { body: data.body, status: "responded" },
        { new: true },
      );
      await audit(
        String(incident.organizationId),
        req.auth!.userId,
        "incident.explanation_submitted",
        "Incident",
        incident.id,
      );
      res.json(explanation);
    } catch (e) {
      next(e);
    }
  },
);
app.post(
  "/api/organizations/:organizationId/attempts/:attemptId/grade",
  authenticate,
  authorize("institute_admin", "teacher"),
  async (req: AuthRequest, res) => {
    const attempt = await ExamAttempt.findOne({
      _id: req.params.attemptId,
      organizationId: req.auth!.organizationId,
      status: { $in: ["submitted", "expired"] },
    });
    if (!attempt)
      return res.status(404).json({ error: "Submitted attempt not found" });
    const [questions, answers] = await Promise.all([
      Question.find({
        organizationId: req.auth!.organizationId,
        examId: attempt.examId,
      }).lean(),
      AttemptAnswer.find({ attemptId: attempt._id }).lean(),
    ]);
    const automatic = automaticallyGrade(questions, answers);
    const maxMarks = questions.reduce((total, q) => total + q.marks, 0);
    const grade = await Grade.findOneAndUpdate(
      { attemptId: attempt._id },
      {
        organizationId: req.auth!.organizationId,
        examId: attempt.examId,
        candidateId: attempt.candidateId,
        autoMarks: automatic.marks,
        totalMarks: automatic.marks,
        maxMarks,
        status: automatic.needsManual ? "pending_manual" : "graded",
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await audit(
      req.auth!.organizationId!,
      req.auth!.userId,
      "grade.auto_evaluated",
      "Grade",
      grade.id,
    );
    res.json(grade);
  },
);
app.put(
  "/api/organizations/:organizationId/grades/:gradeId/manual",
  authenticate,
  authorize("institute_admin", "teacher"),
  async (req: AuthRequest, res, next) => {
    try {
      const data = z
        .object({
          manualMarks: z.number().min(0),
          feedback: z.string().max(4000).optional(),
        })
        .parse(req.body);
      const grade = await Grade.findOne({
        _id: req.params.gradeId,
        organizationId: req.auth!.organizationId,
      });
      if (!grade || grade.status === "published")
        return res.status(404).json({ error: "Editable grade not found" });
      grade.manualMarks = data.manualMarks;
      grade.totalMarks = grade.autoMarks + data.manualMarks;
      grade.feedback = data.feedback;
      grade.status = "graded";
      await grade.save();
      await audit(
        req.auth!.organizationId!,
        req.auth!.userId,
        "grade.manual_evaluated",
        "Grade",
        grade.id,
      );
      res.json(grade);
    } catch (e) {
      next(e);
    }
  },
);
app.post(
  "/api/organizations/:organizationId/grades/:gradeId/publish",
  authenticate,
  authorize("institute_admin", "teacher"),
  async (req: AuthRequest, res) => {
    const grade = await Grade.findOne({
      _id: req.params.gradeId,
      organizationId: req.auth!.organizationId,
      status: "graded",
    });
    if (!grade)
      return res.status(404).json({ error: "Graded result not found" });
    grade.status = "published";
    grade.publishedAt = new Date();
    grade.publishedBy = req.auth!.userId as never;
    await grade.save();
    const candidate = await Candidate.findById(grade.candidateId);
    if (candidate?.userId)
      await notify(
        req.auth!.organizationId!,
        candidate.userId,
        "result_published",
        "Result published",
        "Your exam result is now available.",
        { gradeId: grade.id },
      );
    await audit(
      req.auth!.organizationId!,
      req.auth!.userId,
      "grade.published",
      "Grade",
      grade.id,
    );
    res.json(grade);
  },
);
app.get(
  "/api/organizations/:organizationId/reports/summary",
  authenticate,
  authorize("institute_admin", "teacher", "proctor"),
  async (req: AuthRequest, res) => {
    const organizationId = req.auth!.organizationId!;
    const examId =
      typeof req.query.examId === "string" ? req.query.examId : undefined;
    const since =
      typeof req.query.from === "string" ? new Date(req.query.from) : undefined;
    const attemptQuery = {
      organizationId,
      ...(examId ? { examId } : {}),
      ...(since && !Number.isNaN(+since) ? { createdAt: { $gte: since } } : {}),
    };
    const [
      assigned,
      attempts,
      submitted,
      incidents,
      verificationApproved,
      grades,
    ] = await Promise.all([
      ExamAssignment.countDocuments({
        organizationId,
        ...(examId ? { examId } : {}),
      }),
      ExamAttempt.countDocuments(attemptQuery),
      ExamAttempt.countDocuments({
        ...attemptQuery,
        status: { $in: ["submitted", "expired"] },
      }),
      Incident.countDocuments({
        organizationId,
        ...(examId ? { examId } : {}),
      }),
      VerificationRequest.countDocuments({
        organizationId,
        status: "approved",
      }),
      Grade.find({ organizationId, ...(examId ? { examId } : {}) }).lean(),
    ]);
    res.json({
      completionRate: assigned ? submitted / assigned : 0,
      submission: { assigned, attempts, submitted },
      incidents,
      verificationApproved,
      grades: grades.map((g) => ({
        candidateId: g.candidateId,
        totalMarks: g.totalMarks,
        maxMarks: g.maxMarks,
        status: g.status,
      })),
    });
  },
);
app.get(
  "/api/organizations/:organizationId/reports/export.csv",
  authenticate,
  authorize("institute_admin", "teacher"),
  async (req: AuthRequest, res) => {
    const grades = await Grade.find({
      organizationId: req.auth!.organizationId,
    })
      .populate("candidateId", "name email")
      .lean();
    const escape = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    const csv = [
      "candidate,score,max_marks,status",
      ...grades.map(
        (g) =>
          `${escape((g.candidateId as unknown as { name?: string })?.name)},${g.totalMarks},${g.maxMarks},${g.status}`,
      ),
    ].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="sentinelexam-results.csv"',
    );
    res.send(csv);
  },
);
app.get("/api/notifications", authenticate, async (req: AuthRequest, res) =>
  res.json({
    emailConfigured: false,
    emailStatus: "unavailable: no outbound email adapter is installed",
    notifications: await Notification.find({ userId: req.auth!.userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
  }),
);
app.post(
  "/api/notifications/:id/read",
  authenticate,
  async (req: AuthRequest, res) => {
    const n = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.auth!.userId },
      { readAt: new Date() },
      { new: true },
    );
    if (!n) return res.status(404).json({ error: "Notification not found" });
    res.json(n);
  },
);
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (error instanceof z.ZodError)
      return res
        .status(400)
        .json({ error: "Invalid input", details: error.flatten() });
    if (error instanceof multer.MulterError)
      return res.status(400).json({ error: "Invalid upload" });
    console.error(error);
    res.status(500).json({ error: "Unexpected server error" });
  },
);
