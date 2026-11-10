-- AlterTable
ALTER TABLE "radio_observations" ADD COLUMN     "expiresAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + interval '30 days');

-- CreateIndex
CREATE INDEX "radio_observations_expiresAt_idx" ON "radio_observations"("expiresAt");
