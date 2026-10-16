import test from 'node:test'; import assert from 'node:assert/strict';
import { automaticallyGrade } from '../src/grading.js';
const questions = [
  { _id: 'one', type: 'mcq', correctAnswer: 'a', marks: 2, negativeMarks: 0.5 },
  { _id: 'two', type: 'multiple_select', correctAnswer: ['a', 'c'], marks: 4, negativeMarks: 1 },
  { _id: 'three', type: 'descriptive', marks: 6, negativeMarks: 0 }
];
test('automatic grading awards correct answers, applies configured negative marks, and flags manual work', () => { const grade = automaticallyGrade(questions, [{ questionId: 'one', value: 'a' }, { questionId: 'two', value: ['a'] }]); assert.deepEqual(grade, { marks: 1, needsManual: true }); });
test('missing answers receive no negative marking', () => { const grade = automaticallyGrade(questions.slice(0, 1), []); assert.equal(grade.marks, 0); });
