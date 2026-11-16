import test from 'node:test';
import assert from 'node:assert/strict';
import { getDemoSeedConfiguration } from '../scripts/seed-config.js';

const validEnvironment = {
  DEMO_SEED: 'yes',
  DEMO_SEED_PASSWORD: 'local-test-password',
  DATABASE_URL: 'postgresql://examguard@127.0.0.1:5432/examguard_test',
};

test('requires a unique explicit demo password', () => {
  assert.throws(
    () => getDemoSeedConfiguration({ ...validEnvironment, DEMO_SEED_PASSWORD: '' }),
    /unique DEMO_SEED_PASSWORD/
  );
  assert.throws(
    () => getDemoSeedConfiguration({ ...validEnvironment, DEMO_SEED_PASSWORD: 'short' }),
    /unique DEMO_SEED_PASSWORD/
  );
});

test('refuses non-loopback and production-like database targets', () => {
  assert.throws(
    () => getDemoSeedConfiguration({
      ...validEnvironment,
      DATABASE_URL: 'postgresql://examguard@db.example.invalid:5432/examguard_dev',
    }),
    /loopback non-production PostgreSQL/
  );
  assert.throws(
    () => getDemoSeedConfiguration({
      ...validEnvironment,
      DATABASE_URL: 'postgresql://examguard@localhost:5432/examguard_prod',
    }),
    /loopback non-production PostgreSQL/
  );
});

test('accepts a loopback non-production PostgreSQL database', () => {
  assert.deepEqual(getDemoSeedConfiguration(validEnvironment), { password: 'local-test-password' });
});
