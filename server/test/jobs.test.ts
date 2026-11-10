
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MemoryJobStore,
  PermanentJobError,
  afterFailure,
  backoffMs,
  jobKey,
  runDueJobs,
  safeJobError,
} from '../src/jobs.js';

const t0 = new Date('2026-11-07T10:00:00Z');
const mid = () => 0.5;

test('job keys are stable and distinguish inputs', () => {
  assert.equal(jobKey('exam.close', 'a', 1), jobKey('exam.close', 'a', 1));
  assert.notEqual(jobKey('exam.close', 'a', 1), jobKey('exam.close', 'a', 2));
});

test('backoff grows exponentially, is capped and jittered', () => {
  assert.equal(backoffMs(1, 1000, 60_000, () => 1), 1000);
  assert.equal(backoffMs(3, 1000, 60_000, () => 1), 4000);
  assert.equal(backoffMs(20, 1000, 60_000, () => 1), 60_000);
  assert.equal(backoffMs(1, 1000, 60_000, () => 0), 500);
});

test('enqueue is idempotent by key', async () => {
  const s = new MemoryJobStore();
  assert.deepEqual(await s.enqueue({ type: 'x', key: 'k' }), { created: true });
  assert.deepEqual(await s.enqueue({ type: 'x', key: 'k' }), { created: false });
  assert.equal(s.jobs.size, 1);
});

test('successful job runs once and is audited', async () => {
  const s = new MemoryJobStore();
  await s.enqueue({ type: 'x', key: 'k', organizationId: 'org' });

  let runs = 0;

  const r1 = await runDueJobs(
    s,
    { x: async () => { runs++; } },
    { workerId: 'w1', now: () => t0 },
  );

  const r2 = await runDueJobs(
    s,
    { x: async () => { runs++; } },
    { workerId: 'w1', now: () => t0 },
  );

  assert.deepEqual(r1, { succeeded: 1, retried: 0, dead: 0 });
  assert.equal(r2.succeeded, 0);
  assert.equal(runs, 1);
  assert.equal(s.audits[0].outcome, 'succeeded');
});

test('future jobs are not claimed early', async () => {
  const s = new MemoryJobStore();
  await s.enqueue({
    type: 'x',
    key: 'k',
    runAt: new Date(t0.getTime() + 60_000),
  });

  assert.equal((await s.claim('w', t0, 5, 1000)).length, 0);
});

test('failures retry with backoff then dead-letter at the retry limit', async () => {
  const s = new MemoryJobStore();
  await s.enqueue({ type: 'x', key: 'k', maxAttempts: 2 });

  const fail = {
    x: async () => {
      throw new Error('boom token=abc123456');
    },
  };

  let now = t0;

  const a = await runDueJobs(s, fail, {
    workerId: 'w',
    now: () => now,
    random: mid,
  });

  assert.deepEqual(a, { succeeded: 0, retried: 1, dead: 0 });

  const job = [...s.jobs.values()][0];
  assert.ok(job.runAt > now);
  assert.ok(!job.lastError!.includes('abc123456'));

  now = new Date(job.runAt.getTime() + 1);

  const b = await runDueJobs(s, fail, {
    workerId: 'w',
    now: () => now,
    random: mid,
  });

  assert.deepEqual(b, { succeeded: 0, retried: 0, dead: 1 });
  assert.equal(job.status, 'dead');
  assert.equal(job.attempts, 2);
});

test('permanent errors and missing handlers dead-letter immediately', async () => {
  const s = new MemoryJobStore();
  await s.enqueue({ type: 'x', key: 'a' });
  await s.enqueue({ type: 'unknown', key: 'b' });

  const r = await runDueJobs(
    s,
    {
      x: async () => {
        throw new PermanentJobError('bad payload');
      },
    },
    { workerId: 'w', now: () => t0 },
  );

  assert.equal(r.dead, 2);
});

test('crashed worker: expired lease is recovered by another worker, stale worker cannot complete', async () => {
  const s = new MemoryJobStore();
  await s.enqueue({ type: 'x', key: 'k' });

  const [claimed] = await s.claim('crashed', t0, 1, 30_000);

  assert.equal(
    (await s.claim('other', new Date(t0.getTime() + 10_000), 1, 30_000)).length,
    0,
    'lease still valid',
  );

  const [recovered] = await s.claim(
    'other',
    new Date(t0.getTime() + 31_000),
    1,
    30_000,
  );

  assert.equal(recovered.id, claimed.id);
  assert.equal(recovered.attempts, 2);

  // MemoryJobStore.succeed() accepts only id and workerId.
  assert.equal(await s.succeed(claimed.id, 'crashed'), false);
  assert.equal(await s.succeed(recovered.id, 'other'), true);
});

test('concurrent claims never hand the same job to two workers', async () => {
  const s = new MemoryJobStore();

  for (let i = 0; i < 6; i++) {
    await s.enqueue({ type: 'x', key: `k${i}` });
  }

  const [a, b] = await Promise.all([
    s.claim('w1', t0, 3, 1000),
    s.claim('w2', t0, 3, 1000),
  ]);

  assert.equal(
    new Set([...a, ...b].map(j => j.id)).size,
    a.length + b.length,
  );
});

test('error sanitiser removes emails and secrets', () => {
  assert.ok(
    !safeJobError(new Error('mail a@b.com failed Bearer abcdefghijk'))
      .match(/a@b\.com|abcdefghijk/),
  );

  assert.ok(
    afterFailure({ attempts: 1, maxAttempts: 3 }, new Error('x'), t0).status === 'queued',
  );
});
