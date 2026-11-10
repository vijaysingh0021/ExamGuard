import crypto from 'node:crypto';
export const passwordPolicy = (password: string) => password.length >= 10 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password);
export const createResetToken = () => crypto.randomBytes(32).toString('base64url');
export const hashResetToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
export const createOtp = () => crypto.randomInt(100000, 1000000).toString();
const configuredNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
export const otpConfig = () => ({
  ttlMs: Math.max(60_000, configuredNumber(process.env.PASSWORD_RESET_OTP_TTL_MINUTES, 10) * 60_000),
  resendCooldownMs: Math.max(10_000, configuredNumber(process.env.PASSWORD_RESET_OTP_RESEND_COOLDOWN_SECONDS, 60) * 1000),
  maxAttempts: Math.max(1, Math.floor(configuredNumber(process.env.PASSWORD_RESET_OTP_MAX_ATTEMPTS, 5))),
});
