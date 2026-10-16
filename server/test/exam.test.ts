import test from 'node:test'; import assert from 'node:assert/strict';
import { canStartExam, deadlineFor, isAttemptOpen } from '../src/exam.js';
test('server deadline uses the earlier scheduled end', () => { const start = new Date('2030-01-01T10:00:00Z'); assert.equal(deadlineFor(start, 90, new Date('2030-01-01T10:30:00Z')).toISOString(), '2030-01-01T10:30:00.000Z'); });
test('attempt persistence rules close expired and submitted attempts', () => { assert.equal(isAttemptOpen('in_progress', new Date(Date.now() + 1000)), true); assert.equal(isAttemptOpen('submitted', new Date(Date.now() + 1000)), false); assert.equal(isAttemptOpen('in_progress', new Date(Date.now() - 1000)), false); });
test('scheduled access is constrained by server time', () => { const now = new Date('2030-01-01T10:00:00Z'); assert.equal(canStartExam(now, new Date('2030-01-01T10:01:00Z'), undefined), false); assert.equal(canStartExam(now, new Date('2030-01-01T09:00:00Z'), new Date('2030-01-01T11:00:00Z')), true); });
