import { randomUUID } from 'node:crypto';
import { emailProviderFromEnv } from './email.js';

async function sendPasswordEmail(to: string, subject: string, text: string) {
  const provider = emailProviderFromEnv();
  if (!provider) throw new Error('Password reset email delivery is not configured');
  await provider.send({ to, subject, text, idempotencyKey: `password-reset:${randomUUID()}` });
}

export async function sendPasswordResetEmail(to: string, link: string) {
  await sendPasswordEmail(to, 'Reset your ExamGuard password', `Open this link to reset your password. It expires in 15 minutes: ${link}`);
}

export async function sendPasswordOtpEmail(to: string, otp: string) {
  const parsedTtl = Number(process.env.PASSWORD_RESET_OTP_TTL_MINUTES);
  const ttl = Number.isFinite(parsedTtl) && parsedTtl > 0 ? parsedTtl : 10;
  await sendPasswordEmail(to, 'Your ExamGuard password reset code', `Your ExamGuard password reset code is ${otp}. It expires in ${ttl} minutes and can be used once.`);
}

export async function sendSignupOtpEmail(to: string, otp: string) {
  await sendPasswordEmail(to, 'Verify your ExamGuard signup', `Your ExamGuard signup verification code is ${otp}. It expires in 10 minutes and can be used once. Never share this code with anyone.`);
}

export async function sendPasswordChangeConfirmationEmail(to: string) {
  await sendPasswordEmail(to, 'Your ExamGuard password was changed', 'Your ExamGuard password was changed successfully. If you did not make this change, contact your institution administrator immediately.');
}
