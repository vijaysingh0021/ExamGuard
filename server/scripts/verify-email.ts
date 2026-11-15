import '../src/config.js';
import { emailProviderFromEnv, SmtpEmailProvider } from '../src/email.js';

async function main() {
  const provider = emailProviderFromEnv();
  if (!(provider instanceof SmtpEmailProvider)) {
    const reason = provider ? `Configured email provider is "${provider.name}", not SMTP.` : 'SMTP settings are missing or invalid.';
    console.error('email.smtp.verify', { status: 'failed', reason });
    process.exitCode = 1;
    return;
  }

  try {
    await provider.verify();
    console.info('email.smtp.verify', {
      status: 'ok',
      message: 'SMTP connection and authentication succeeded; no email was sent.',
      senderMustBeVerifiedInProvider: true,
    });
  } catch {
    console.error('email.smtp.verify', { status: 'failed', message: 'SMTP connection or authentication failed; see the structured SMTP failure log.' });
    process.exitCode = 1;
  }
}

void main();
