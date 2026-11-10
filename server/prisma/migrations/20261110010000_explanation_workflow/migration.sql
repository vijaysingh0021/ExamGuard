-- Additive explanation workflow fields. Apply only to the isolated development database.
CREATE TYPE "ExplanationDecision" AS ENUM ('accepted', 'dismissed', 'escalated');

ALTER TABLE "student_explanations"
  ADD COLUMN "requestedById" UUID,
  ADD COLUMN "decidedById" UUID,
  ADD COLUMN "question" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "deadlineAt" TIMESTAMP(3),
  ADD COLUMN "respondedAt" TIMESTAMP(3),
  ADD COLUMN "decision" "ExplanationDecision",
  ADD COLUMN "decisionReason" TEXT,
  ADD COLUMN "decisionAt" TIMESTAMP(3),
  ADD COLUMN "reopenedAt" TIMESTAMP(3);

CREATE INDEX "student_explanations_organizationId_status_idx"
  ON "student_explanations"("organizationId", "status");

ALTER TABLE "student_explanations"
  ADD CONSTRAINT "student_explanations_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "student_explanations_decidedById_fkey"
  FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
