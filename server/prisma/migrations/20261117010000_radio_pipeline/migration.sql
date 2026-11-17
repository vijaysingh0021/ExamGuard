ALTER TYPE "RadioKind" ADD VALUE IF NOT EXISTS 'scanner_status';
ALTER TYPE "RadioKind" ADD VALUE IF NOT EXISTS 'scan_complete';

ALTER TABLE "radio_candidate_signals"
ADD COLUMN "dedupeKey" TEXT;

CREATE UNIQUE INDEX "radio_candidate_signals_dedupeKey_key"
ON "radio_candidate_signals"("dedupeKey");

CREATE INDEX "radio_observations_org_attempt_source_kind_pseudonym_time_idx"
ON "radio_observations"(
  "organizationId",
  "attemptId",
  "source",
  "kind",
  "pseudonym",
  "observedAt" DESC
);
