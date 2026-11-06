import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateCaseResults, declaredCodingLanguages, outputMatches } from '../src/coding.js';

test('declared coding languages remain unavailable until an isolated runner is configured', () => {
  assert.equal(declaredCodingLanguages.length, 5);
  assert.ok(declaredCodingLanguages.every(language => language.runnerStatus === 'not_configured'));
});

test('exact and explicitly whitespace-normalized judging remain distinct', () => {
  assert.equal(outputMatches('answer\n', 'answer', 'exact'), false);
  assert.equal(outputMatches(' answer  \r\n\n', 'answer', 'whitespace_normalized'), true);
  assert.equal(outputMatches('a b', 'ab', 'whitespace_normalized'), false);
});

test('candidate execution results never expose private test data', () => {
  const [sample, hidden] = candidateCaseResults([
    { id: 'sample-1', visibility: 'sample', passed: true, status: 'accepted', input: '2', expectedOutput: '4', actualOutput: '4' },
    { id: 'private-1', visibility: 'private', passed: false, status: 'wrong_answer', input: 'secret input', expectedOutput: 'secret output', actualOutput: 'guess' }
  ]);
  assert.deepEqual(sample, { id: 'sample-1', visibility: 'sample', passed: true, status: 'accepted', input: '2', expectedOutput: '4', actualOutput: '4', executionTimeMs: undefined, memoryBytes: undefined });
  assert.deepEqual(hidden, { id: 'private-1', visibility: 'private', passed: false, status: 'wrong_answer', executionTimeMs: undefined, memoryBytes: undefined });
});
