import { randomUUID } from 'node:crypto';
import { emailProviderFromEnv, EmailPermanentError, EmailTransientError } from './email.js';

async function sendPasswordEmail(operation: string, to: string, subject: string, text: string) {
  const provider = emailProviderFromEnv();
  if (!provider) {
    console.error('email.request.failed', { operation, provider: 'unavailable', reason: 'not_configured' });
    throw new Error('Email delivery is not configured');
  }
  console.info('email.request.started', { operation, provider: provider.name });
  try {
    await provider.send({ to, subject, text, idempotencyKey: `${operation}:${randomUUID()}` });
    console.info('email.request.completed', { operation, provider: provider.name });
  } catch (error) {
    const reason = error instanceof EmailTransientError ? 'transient_provider_failure'
      : error instanceof EmailPermanentError ? 'provider_rejected'
      : 'provider_failure';
    console.error('email.request.failed', { operation, provider: provider.name, reason });
    throw error;
  }
}

export async function sendPasswordResetEmail(to: string, link: string) {
  await sendPasswordEmail('password_reset_link', to, 'Reset your ExamGuard password', `Open this link to reset your password. It expires in 15 minutes: ${link}`);
}

export async function sendPasswordOtpEmail(to: string, otp: string) {
  const parsedTtl = Number(process.env.PASSWORD_RESET_OTP_TTL_MINUTES);
  const ttl = Number.isFinite(parsedTtl) && parsedTtl > 0 ? parsedTtl : 10;
  await sendPasswordEmail('password_reset_otp', to, 'Your ExamGuard password reset code', `Your ExamGuard password reset code is ${otp}. It expires in ${ttl} minutes and can be used once.`);
}

export async function sendSignupOtpEmail(to: string, otp: string) {
  await sendPasswordEmail('signup_otp', to, 'Verify your ExamGuard signup', `Your ExamGuard signup verification code is ${otp}. It expires in 10 minutes and can be used once. Never share this code with anyone.`);
}

export async function sendPasswordChangeConfirmationEmail(to: string) {
  await sendPasswordEmail('password_change_confirmation', to, 'Your ExamGuard password was changed', 'Your ExamGuard password was changed successfully. If you did not make this change, contact your institution administrator immediately.');
}
