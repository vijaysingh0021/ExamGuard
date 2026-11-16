import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const configuredTestDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!configuredTestDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL must be explicitly configured for the backend test suite.');
}

const testDatabaseUrl = new URL(configuredTestDatabaseUrl);
if (
  !['postgres:', 'postgresql:'].includes(testDatabaseUrl.protocol) ||
  !['localhost', '127.0.0.1'].includes(testDatabaseUrl.hostname) ||
  decodeURIComponent(testDatabaseUrl.pathname.replace(/^\/+/, '')) !== 'examguard_test'
) {
  throw new Error('TEST_DATABASE_URL must target the local examguard_test database.');
}

process.env.DATABASE_URL = testDatabaseUrl.toString();

const testFiles = readdirSync(__dirname)
  .filter(file => file.endsWith('.test.ts'))
  .sort();

for (const file of testFiles) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', join('test', file), '--test-concurrency=1'], {
    cwd: join(process.cwd()),
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
