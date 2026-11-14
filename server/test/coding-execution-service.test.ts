import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateExecutionStatus, candidateExecutionResults, executeCodingCases } from '../src/coding-execution-service.js';
import type { CodeRunnerAdapter, RunnerResult } from '../src/judge0-adapter.js';

class FakeRunner implements CodeRunnerAdapter {
  private nextToken = 0;
  private readonly results = new Map<string, RunnerResult>();

  async createSubmission(submission: { stdin: string }) {
    const token = `token-${this.nextToken++}`;
    this.results.set(token, {
      token,
      status: 'accepted',
      stdout: submission.stdin === 'private-input' ? 'private-output' : 'visible-output',
    });
    return { token };
  }

  async getSubmission(token: string) {
    const result = this.results.get(token);
    if (!result) throw new Error('Unknown token');
    return result;
  }
}

test('run case execution compares output and does not return private output', async () => {
  const results = await executeCodingCases({
    runner: new FakeRunner(),
    cases: [
      { id: 'sample-1', visibility: 'sample', input: 'visible-input', expectedOutput: 'visible-output' },
      { id: 'private-1', visibility: 'private', input: 'private-input', expectedOutput: 'private-output' },
    ],
    languageId: 71,
    sourceCode: 'print("ok")',
    cpuTimeLimitSeconds: 2,
    memoryLimitKb: 65_536,
    comparisonMode: 'exact',
  });

  assert.equal(aggregateExecutionStatus(results), 'accepted');
  const candidate = candidateExecutionResults(results);
  assert.deepEqual(candidate.cases.map(item => item.id), ['sample-1']);
  assert.equal(candidate.cases[0].actualOutput, 'visible-output');
  assert.deepEqual(candidate.privateTests, { passed: 1, total: 1 });
  assert.equal(JSON.stringify(candidate).includes('private-output'), false);
});

test('case execution applies whitespace comparison and aggregates a wrong answer', async () => {
  const results = await executeCodingCases({
    runner: new FakeRunner(),
    cases: [{ id: 'sample-1', visibility: 'sample', input: 'visible-input', expectedOutput: ' visible-output \n' }],
    languageId: 71,
    sourceCode: 'print("ok")',
    cpuTimeLimitSeconds: 2,
    memoryLimitKb: 65_536,
    comparisonMode: 'whitespace_normalized',
  });

  assert.equal(results[0].passed, true);
  assert.equal(aggregateExecutionStatus(results), 'accepted');

  const wrong = await executeCodingCases({
    runner: new FakeRunner(),
    cases: [{ id: 'sample-1', visibility: 'sample', input: 'visible-input', expectedOutput: 'different' }],
    languageId: 71,
    sourceCode: 'print("ok")',
    cpuTimeLimitSeconds: 2,
    memoryLimitKb: 65_536,
    comparisonMode: 'exact',
  });
  assert.equal(aggregateExecutionStatus(wrong), 'wrong_answer');
});
