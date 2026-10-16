export async function sendPasswordResetEmail(to: string, link: string) {
  if (process.env.EMAIL_PROVIDER !== 'webhook' || !process.env.EMAIL_URL || !process.env.EMAIL_FROM) throw new Error('Password reset email delivery is not configured');
  const response = await fetch(process.env.EMAIL_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject: 'Reset your ExamGuard password', text: `Open this link to reset your password. It expires in 15 minutes: ${link}` }) });
  if (!response.ok) throw new Error('Password reset email delivery failed');
}
