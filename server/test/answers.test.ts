import test from 'node:test'; import assert from 'node:assert/strict'; import { ZodError } from 'zod'; import { validateAnswerValue } from '../src/answers.js';
const options = [{ id: 'a', text: 'One' }, { id: 'b', text: 'Two' }, { id: 'c', text: 'Three' }];
test('single-choice answers must be one of the question options', () => {
  assert.equal(validateAnswerValue({ type: 'mcq', options }, 'b'), 'b');
  assert.throws(() => validateAnswerValue({ type: 'mcq', options }, 'z'), ZodError);
  assert.throws(() => validateAnswerValue({ type: 'mcq', options }, ['a']), ZodError);
});
test('multiple-select answers must be unique option ids', () => {
  assert.deepEqual(validateAnswerValue({ type: 'multiple_select', options }, ['a', 'c']), ['a', 'c']);
  assert.throws(() => validateAnswerValue({ type: 'multiple_select', options }, ['a', 'a']), ZodError);
  assert.throws(() => validateAnswerValue({ type: 'multiple_select', options }, ['x']), ZodError);
});
test('text answers are bounded strings and tolerate questions without options', () => {
  assert.equal(validateAnswerValue({ type: 'descriptive', options: null }, 'An explanation'), 'An explanation');
  assert.throws(() => validateAnswerValue({ type: 'short_answer', options: [] }, 'x'.repeat(50_001)), ZodError);
});
