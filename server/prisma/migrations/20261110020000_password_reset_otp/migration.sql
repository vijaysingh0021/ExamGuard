-- Additive password-reset OTP and session invalidation fields.
ALTER TABLE "password_reset_tokens"
  ADD COLUMN "otpAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastSentAt" TIMESTAMP(3),
  ADD COLUMN "otpVerifiedAt" TIMESTAMP(3);
