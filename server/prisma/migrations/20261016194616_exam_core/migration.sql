-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('browser', 'ai_service');

-- CreateEnum
CREATE TYPE "PolicyAction" AS ENUM ('recorded', 'warning', 'paused', 'terminated', 'technical');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('open', 'dismissed', 'resolved', 'escalated', 'awaiting_student');

-- CreateEnum
CREATE TYPE "ExplanationStatus" AS ENUM ('requested', 'responded', 'follow_up', 'closed');

-- CreateEnum
CREATE TYPE "RadioSource" AS ENUM ('bluetooth_le', 'wifi', 'scanner_health');

-- CreateEnum
CREATE TYPE "RadioKind" AS ENUM ('advertisement', 'access_point', 'scan_unavailable', 'permission_denied', 'scan_error', 'scan_stopped');

-- CreateEnum
CREATE TYPE "ScannerStatus" AS ENUM ('active', 'unavailable', 'permission_denied', 'stopped', 'error');

-- CreateEnum
CREATE TYPE "RadioSignalStatus" AS ENUM ('pending_review', 'reviewed_no_concern', 'reviewed_concern_retained', 'insufficient_evidence');

-- CreateTable
CREATE TABLE "proctoring_events" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "sessionId" UUID,
    "attemptId" UUID,
    "type" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "source" "EventSource" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "evidenceKey" TEXT,
    "fingerprint" TEXT NOT NULL,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "policyAction" "PolicyAction" NOT NULL DEFAULT 'recorded',
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proctoring_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "examId" UUID,
    "candidateId" UUID,
    "sessionId" UUID,
    "severity" "Severity" NOT NULL,
    "type" TEXT NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'open',
    "details" TEXT,
    "riskPriority" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "contributingSignals" JSONB NOT NULL DEFAULT '[]',
    "decisionReason" TEXT,
    "reviewerNotes" TEXT,
    "explanationDeadlineAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_events" (
    "incidentId" UUID NOT NULL,
    "eventId" UUID NOT NULL,

    CONSTRAINT "incident_events_pkey" PRIMARY KEY ("incidentId","eventId")
);

-- CreateTable
CREATE TABLE "student_explanations" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "evidenceKey" TEXT,
    "followUpQuestion" TEXT,
    "status" "ExplanationStatus" NOT NULL DEFAULT 'requested',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_explanations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radio_observations" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "source" "RadioSource" NOT NULL,
    "kind" "RadioKind" NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "rssi" INTEGER,
    "pseudonym" TEXT,
    "scannerStatus" "ScannerStatus" NOT NULL,
    "errorCode" TEXT,
    "fingerprint" TEXT NOT NULL,
    "limitations" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "radio_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radio_candidate_signals" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "rule" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" "RadioSignalStatus" NOT NULL DEFAULT 'pending_review',
    "reviewerId" UUID,
    "reviewerNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "radio_candidate_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radio_signal_observations" (
    "signalId" UUID NOT NULL,
    "observationId" UUID NOT NULL,

    CONSTRAINT "radio_signal_observations_pkey" PRIMARY KEY ("signalId","observationId")
);

-- CreateIndex
CREATE INDEX "proctoring_events_organizationId_fingerprint_occurredAt_idx" ON "proctoring_events"("organizationId", "fingerprint", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "proctoring_events_examId_idx" ON "proctoring_events"("examId");

-- CreateIndex
CREATE INDEX "proctoring_events_attemptId_idx" ON "proctoring_events"("attemptId");

-- CreateIndex
CREATE INDEX "incidents_organizationId_status_idx" ON "incidents"("organizationId", "status");

-- CreateIndex
CREATE INDEX "incidents_examId_idx" ON "incidents"("examId");

-- CreateIndex
CREATE INDEX "incidents_candidateId_idx" ON "incidents"("candidateId");

-- CreateIndex
CREATE INDEX "incident_events_eventId_idx" ON "incident_events"("eventId");

-- CreateIndex
CREATE INDEX "student_explanations_organizationId_idx" ON "student_explanations"("organizationId");

-- CreateIndex
CREATE INDEX "student_explanations_incidentId_idx" ON "student_explanations"("incidentId");

-- CreateIndex
CREATE INDEX "student_explanations_candidateId_idx" ON "student_explanations"("candidateId");

-- CreateIndex
CREATE INDEX "radio_observations_organizationId_attemptId_observedAt_idx" ON "radio_observations"("organizationId", "attemptId", "observedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "radio_observations_organizationId_fingerprint_key" ON "radio_observations"("organizationId", "fingerprint");

-- CreateIndex
CREATE INDEX "radio_candidate_signals_organizationId_attemptId_rule_statu_idx" ON "radio_candidate_signals"("organizationId", "attemptId", "rule", "status");

-- CreateIndex
CREATE INDEX "radio_signal_observations_observationId_idx" ON "radio_signal_observations"("observationId");

-- AddForeignKey
ALTER TABLE "proctoring_events" ADD CONSTRAINT "proctoring_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proctoring_events" ADD CONSTRAINT "proctoring_events_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proctoring_events" ADD CONSTRAINT "proctoring_events_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proctoring_events" ADD CONSTRAINT "proctoring_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "exam_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proctoring_events" ADD CONSTRAINT "proctoring_events_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "exam_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "exam_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "proctoring_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_explanations" ADD CONSTRAINT "student_explanations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_explanations" ADD CONSTRAINT "student_explanations_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_explanations" ADD CONSTRAINT "student_explanations_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radio_observations" ADD CONSTRAINT "radio_observations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radio_observations" ADD CONSTRAINT "radio_observations_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radio_observations" ADD CONSTRAINT "radio_observations_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radio_observations" ADD CONSTRAINT "radio_observations_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "exam_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radio_candidate_signals" ADD CONSTRAINT "radio_candidate_signals_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radio_candidate_signals" ADD CONSTRAINT "radio_candidate_signals_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radio_candidate_signals" ADD CONSTRAINT "radio_candidate_signals_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radio_candidate_signals" ADD CONSTRAINT "radio_candidate_signals_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "exam_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radio_candidate_signals" ADD CONSTRAINT "radio_candidate_signals_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radio_signal_observations" ADD CONSTRAINT "radio_signal_observations_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "radio_candidate_signals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radio_signal_observations" ADD CONSTRAINT "radio_signal_observations_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "radio_observations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
