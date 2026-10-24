-- CreateEnum
CREATE TYPE "GradeStatus" AS ENUM ('pending_manual', 'graded', 'published');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('draft', 'submitted', 'approved', 'rejected', 'resubmission_required');

-- CreateEnum
CREATE TYPE "NotificationDelivery" AS ENUM ('in_app', 'email_unconfigured');

-- CreateTable
CREATE TABLE "exam_sessions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "riskScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grades" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "autoMarks" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "manualMarks" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalMarks" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxMarks" DOUBLE PRECISION NOT NULL,
    "status" "GradeStatus" NOT NULL DEFAULT 'pending_manual',
    "feedback" TEXT,
    "publishedAt" TIMESTAMP(3),
    "publishedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_requests" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'draft',
    "profilePhoto" TEXT,
    "idDocument" TEXT,
    "rejectionReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proctoring_configs" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "samplingIntervalMs" INTEGER NOT NULL DEFAULT 5000,
    "cooldownSeconds" INTEGER NOT NULL DEFAULT 30,
    "lookingAwayDegrees" INTEGER NOT NULL DEFAULT 30,
    "multipleFaceFrames" INTEGER NOT NULL DEFAULT 3,
    "phoneDetectionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "explanationDeadlineHours" INTEGER NOT NULL DEFAULT 72,
    "signalWeights" JSONB NOT NULL DEFAULT '{"face_missing": 15, "multiple_faces": 25, "looking_away": 10, "phone_detected": 30, "visibility_hidden": 10, "fullscreen_exit": 10}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proctoring_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "delivery" "NotificationDelivery" NOT NULL DEFAULT 'in_app',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exam_sessions_organizationId_idx" ON "exam_sessions"("organizationId");

-- CreateIndex
CREATE INDEX "exam_sessions_examId_idx" ON "exam_sessions"("examId");

-- CreateIndex
CREATE INDEX "exam_sessions_candidateId_idx" ON "exam_sessions"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "grades_attemptId_key" ON "grades"("attemptId");

-- CreateIndex
CREATE INDEX "grades_organizationId_idx" ON "grades"("organizationId");

-- CreateIndex
CREATE INDEX "grades_examId_idx" ON "grades"("examId");

-- CreateIndex
CREATE INDEX "grades_candidateId_idx" ON "grades"("candidateId");

-- CreateIndex
CREATE INDEX "verification_requests_organizationId_status_idx" ON "verification_requests"("organizationId", "status");

-- CreateIndex
CREATE INDEX "verification_requests_candidateId_idx" ON "verification_requests"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "proctoring_configs_organizationId_key" ON "proctoring_configs"("organizationId");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_organizationId_idx" ON "notifications"("organizationId");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_createdAt_idx" ON "audit_logs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");

-- AddForeignKey
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "exam_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proctoring_configs" ADD CONSTRAINT "proctoring_configs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
