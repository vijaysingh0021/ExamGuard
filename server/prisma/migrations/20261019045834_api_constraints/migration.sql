/*
  Warnings:

  - A unique constraint covering the columns `[incidentId,candidateId]` on the table `student_explanations` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[organizationId,candidateId]` on the table `verification_requests` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "student_explanations" ALTER COLUMN "body" SET DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "student_explanations_incidentId_candidateId_key" ON "student_explanations"("incidentId", "candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "verification_requests_organizationId_candidateId_key" ON "verification_requests"("organizationId", "candidateId");
