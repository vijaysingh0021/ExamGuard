import test from 'node:test';
import assert from 'node:assert/strict';
import { codingExecutionRequest, codingQuestionInput, codingRateLimits } from '../src/coding-contracts.js';
import { RunnerUnavailableError, UnavailableRunnerAdapter } from '../src/judge0-adapter.js';
import { canWriteCodingSubmission } from '../src/coding-submission-service.js';

test('coding question validation rejects duplicate languages and unsafe execution limits', () => {
  const base = { title: 'Add two numbers', description: 'Return the sum.', difficulty: 'easy', mode: 'stdin_stdout', languageIds: ['python'], marks: 5 };
  assert.equal(codingQuestionInput.parse(base).timeLimitMs, 2000);
  assert.throws(() => codingQuestionInput.parse({ ...base, languageIds: ['python', 'python'] }));
  assert.throws(() => codingQuestionInput.parse({ ...base, timeLimitMs: 30_001 }));
  assert.throws(() => codingQuestionInput.parse({ ...base, memoryLimitKb: 1 }));
});

test('execution contract bounds source code and rate controls distinguish run from submit', () => {
  assert.throws(() => codingExecutionRequest.parse({ questionId: 'not-a-uuid', languageId: 'python', sourceCode: 'print(1)' }));
  assert.equal(codingRateLimits.run.limit, 12);
  assert.equal(codingRateLimits.submit.limit, 4);
  assert.ok(codingRateLimits.submit.limit < codingRateLimits.run.limit);
});

test('unconfigured runner refuses every operation instead of fabricating a result', async () => {
  const runner = new UnavailableRunnerAdapter();
  await assert.rejects(() => runner.createSubmission({ languageId: 71, sourceCode: 'print(1)', stdin: '', expectedOutput: '', cpuTimeLimitSeconds: 1, memoryLimitKb: 16_384 }), RunnerUnavailableError);
  await assert.rejects(() => runner.getSubmission('token'), RunnerUnavailableError);
});

test('coding writes require the candidate, organization, active attempt, and unexpired deadline', () => {
  const access = { attemptId: 'attempt', organizationId: 'organization', candidateUserId: 'candidate', status: 'in_progress' as const, deadlineAt: new Date('2026-11-07T12:00:00.000Z') };
  assert.equal(canWriteCodingSubmission(access, { userId: 'candidate', organizationId: 'organization' }, new Date('2026-11-07T11:59:59.000Z')), true);
  assert.equal(canWriteCodingSubmission(access, { userId: 'other', organizationId: 'organization' }, new Date('2026-11-07T11:59:59.000Z')), false);
  assert.equal(canWriteCodingSubmission(access, { userId: 'candidate', organizationId: 'other' }, new Date('2026-11-07T11:59:59.000Z')), false);
  assert.equal(canWriteCodingSubmission(access, { userId: 'candidate', organizationId: 'organization' }, new Date('2026-11-07T12:00:00.000Z')), false);
});
