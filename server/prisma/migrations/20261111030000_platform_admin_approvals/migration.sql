ALTER TABLE "institution_requests"
  ADD COLUMN "governmentIdDocument" TEXT,
  ADD COLUMN "institutionIdDocument" TEXT,
  ADD COLUMN "authorizationLetterDocument" TEXT,
  ADD COLUMN "institutionEmailVerifiedAt" TIMESTAMP(3);

CREATE TABLE "staff_verification_requests" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "governmentIdDocument" TEXT,
  "institutionIdDocument" TEXT,
  "authorizationDocument" TEXT,
  "status" "VerificationStatus" NOT NULL DEFAULT 'draft',
  "reviewReason" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "staff_verification_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "staff_verification_requests_organizationId_userId_key"
  ON "staff_verification_requests"("organizationId", "userId");
CREATE INDEX "staff_verification_requests_organizationId_status_idx"
  ON "staff_verification_requests"("organizationId", "status");
ALTER TABLE "staff_verification_requests"
  ADD CONSTRAINT "staff_verification_requests_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_verification_requests"
  ADD CONSTRAINT "staff_verification_requests_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_verification_requests"
  ADD CONSTRAINT "staff_verification_requests_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
