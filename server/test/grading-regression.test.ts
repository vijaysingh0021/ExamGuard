import assert from 'node:assert/strict';
import test from 'node:test';
import { gradeStatusAfterAuto, manualMarksWithinBounds, totalMarks } from '../src/grading.js';

test('regression: re-running automatic grading keeps manual marks in the total', () => {
  assert.equal(totalMarks(6, 3), 9); assert.equal(totalMarks(6, null), 6); assert.equal(totalMarks(6), 6);
});
test('regression: manual marks cannot push the total above the exam maximum', () => {
  assert.equal(manualMarksWithinBounds(6, 4, 10), true); assert.equal(manualMarksWithinBounds(6, 4.5, 10), false);
  assert.equal(manualMarksWithinBounds(6, -1, 10), false); assert.equal(manualMarksWithinBounds(6, NaN, 10), false);
});
test('regression: re-grading never makes an unmarked descriptive exam publishable (manualMarks defaults to 0, not null)', () => {
  assert.equal(gradeStatusAfterAuto(true, 'pending_manual'), 'pending_manual', 'a fresh grade with default manualMarks=0 stays pending');
  assert.equal(gradeStatusAfterAuto(true, undefined), 'pending_manual');
  assert.equal(gradeStatusAfterAuto(true, 'graded'), 'graded', 'already manually completed stays complete');
  assert.equal(gradeStatusAfterAuto(false, 'pending_manual'), 'graded');
  assert.equal(gradeStatusAfterAuto(false, undefined), 'graded');
});
