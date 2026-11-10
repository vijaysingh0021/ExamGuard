-- Additive only: creates one new table. Not applied to any database by this change.
CREATE TABLE "background_jobs" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "organizationId" UUID,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "background_jobs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "background_jobs_status_check" CHECK ("status" IN ('queued','running','succeeded','dead'))
);
CREATE UNIQUE INDEX "background_jobs_key_key" ON "background_jobs"("key");
CREATE INDEX "background_jobs_status_runAt_idx" ON "background_jobs"("status", "runAt");
CREATE INDEX "background_jobs_organizationId_type_idx" ON "background_jobs"("organizationId", "type");
