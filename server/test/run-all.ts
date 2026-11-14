import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

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
