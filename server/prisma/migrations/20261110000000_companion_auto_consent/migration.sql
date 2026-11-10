-- Additive local-integration migration. Existing attempt and observation rows are preserved.
ALTER TABLE "exam_attempts"
  ADD COLUMN IF NOT EXISTS "monitoringConsentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "monitoringConsentVersion" TEXT;

ALTER TYPE "RadioKind" ADD VALUE IF NOT EXISTS 'heartbeat';
