-- Additive only: one new table. Not applied to any database by this change.
CREATE TABLE "evidence_objects" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "objectKey" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "evidence_objects_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "evidence_objects_objectKey_key" ON "evidence_objects"("objectKey");
CREATE INDEX "evidence_objects_organizationId_idx" ON "evidence_objects"("organizationId");
