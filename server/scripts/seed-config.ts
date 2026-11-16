export function getDemoSeedConfiguration(environment: NodeJS.ProcessEnv): { password: string } {
  const password = environment.DEMO_SEED_PASSWORD;
  let databaseName = '';
  let isLocalPostgres = false;

  try {
    const databaseUrl = new URL(environment.DATABASE_URL ?? '');
    databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, '')).toLowerCase();
    isLocalPostgres =
      ['postgres:', 'postgresql:'].includes(databaseUrl.protocol) &&
      ['localhost', '127.0.0.1'].includes(databaseUrl.hostname);
  } catch {
    isLocalPostgres = false;
  }

  if (
    environment.DEMO_SEED !== 'yes' ||
    !password ||
    password.length < 12 ||
    !isLocalPostgres ||
    /(^|[-_])(prod|production)([-_]|$)/.test(databaseName)
  ) {
    throw new Error(
      'Refusing to seed. Set DEMO_SEED=yes, a unique DEMO_SEED_PASSWORD of at least 12 characters, and a loopback non-production PostgreSQL DATABASE_URL.'
    );
  }

  return { password };
}
