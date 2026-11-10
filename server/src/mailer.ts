export async function sendPasswordResetEmail(to: string, link: string) {
  if (process.env.EMAIL_PROVIDER !== 'webhook' || !process.env.EMAIL_URL || !process.env.EMAIL_FROM) throw new Error('Password reset email delivery is not configured');
  const response = await fetch(process.env.EMAIL_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject: 'Reset your ExamGuard password', text: `Open this link to reset your password. It expires in 15 minutes: ${link}` }) });
  if (!response.ok) throw new Error('Password reset email delivery failed');
}

export async function sendPasswordOtpEmail(to: string, otp: string) {
  if (process.env.EMAIL_PROVIDER !== 'webhook' || !process.env.EMAIL_URL || !process.env.EMAIL_FROM) throw new Error('Password reset email delivery is not configured');
  const parsedTtl = Number(process.env.PASSWORD_RESET_OTP_TTL_MINUTES);
  const ttl = Number.isFinite(parsedTtl) && parsedTtl > 0 ? parsedTtl : 10;
  const response = await fetch(process.env.EMAIL_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject: 'Your ExamGuard password reset code', text: `Your ExamGuard password reset code is ${otp}. It expires in ${ttl} minutes and can be used once.` }) });
  if (!response.ok) throw new Error('Password reset email delivery failed');
}

export async function sendPasswordChangeConfirmationEmail(to: string) {
  if (process.env.EMAIL_PROVIDER !== 'webhook' || !process.env.EMAIL_URL || !process.env.EMAIL_FROM) throw new Error('Password reset email delivery is not configured');
  const response = await fetch(process.env.EMAIL_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject: 'Your ExamGuard password was changed', text: 'Your ExamGuard password was changed successfully. If you did not make this change, contact your institution administrator immediately.' }) });
  if (!response.ok) throw new Error('Password change confirmation delivery failed');
}
