CREATE TABLE "signup_email_challenges" (
  "id" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "organizationId" UUID,
  "codeHash" TEXT NOT NULL,
  "verificationTokenHash" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "verifiedAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "signup_email_challenges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "signup_email_challenges_email_purpose_organizationId_createdAt_idx"
  ON "signup_email_challenges"("email", "purpose", "organizationId", "createdAt");
CREATE INDEX "signup_email_challenges_expiresAt_idx"
  ON "signup_email_challenges"("expiresAt");
