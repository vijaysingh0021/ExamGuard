import '../src/config.js';
import { emailProviderFromEnv, BrevoEmailProvider, SmtpEmailProvider, emailProviderStatus } from '../src/email.js';

async function main() {
  const provider = emailProviderFromEnv();
  if (!provider) {
    console.error('email.provider.verify', { status: 'failed', ...emailProviderStatus() });
    process.exitCode = 1;
    return;
  }

  try {
    if (provider instanceof SmtpEmailProvider || provider instanceof BrevoEmailProvider) await provider.verify();
    else {
      console.error('email.provider.verify', { status: 'failed', provider: provider.name, reason: 'verification_not_supported' });
      process.exitCode = 1;
      return;
    }
    console.info('email.provider.verify', {
      status: 'ok',
      provider: provider.name,
      message: 'Provider authentication succeeded; no email was sent.',
      ...(provider instanceof BrevoEmailProvider ? { senderVerified: true } : {}),
    });
  } catch {
    console.error('email.provider.verify', {
      status: 'failed',
      provider: provider.name,
      message: 'Provider verification failed; confirm MAIL_FROM is an active verified sender and check the provider logs.',
    });
    process.exitCode = 1;
  }
}

void main();
