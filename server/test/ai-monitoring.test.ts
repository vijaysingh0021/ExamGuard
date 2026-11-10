import test from 'node:test';
import assert from 'node:assert/strict';
import { aiSignalsForFrame, clearAiSignalHistory } from '../src/ai-monitoring.js';

test('AI signals require three positive frames in the rolling five-frame window', () => {
  clearAiSignalHistory();
  const attempt = 'attempt-one';
  assert.deepEqual(aiSignalsForFrame(attempt, { phone_detected: true }), []);
  assert.deepEqual(aiSignalsForFrame(attempt, { phone_detected: true }), []);
  assert.deepEqual(aiSignalsForFrame(attempt, { phone_detected: true }), ['phone_detected']);
});

test('negative frames count in the five-frame window and prevent stale positives', () => {
  clearAiSignalHistory();
  const attempt = 'attempt-two';
  aiSignalsForFrame(attempt, { looking_away: true });
  aiSignalsForFrame(attempt, { looking_away: true });
  aiSignalsForFrame(attempt, { looking_away: false });
  aiSignalsForFrame(attempt, { looking_away: false });
  aiSignalsForFrame(attempt, { looking_away: false });
  assert.deepEqual(aiSignalsForFrame(attempt, { looking_away: true }), []);
  assert.deepEqual(aiSignalsForFrame(attempt, { looking_away: true }), []);
  assert.deepEqual(aiSignalsForFrame(attempt, { looking_away: true }), ['looking_away']);
});

test('signal histories are isolated per attempt', () => {
  clearAiSignalHistory();
  aiSignalsForFrame('attempt-a', { multiple_faces: true });
  aiSignalsForFrame('attempt-a', { multiple_faces: true });
  assert.deepEqual(aiSignalsForFrame('attempt-b', { multiple_faces: true }), []);
});
