import test from 'node:test';
import assert from 'node:assert/strict';
import { explanationResponseOpen, explanationStatusLabel, incidentStatusForExplanation, validExplanationDeadline } from '../src/explanation-workflow.js';

const now = new Date('2026-11-10T00:00:00.000Z');

test('explanation responses are open only for requested or follow-up requests before deadline', () => {
  assert.equal(explanationResponseOpen('requested', new Date('2026-11-11T00:00:00.000Z'), now), true);
  assert.equal(explanationResponseOpen('follow_up', null, now), true);
  assert.equal(explanationResponseOpen('responded', null, now), false);
  assert.equal(explanationResponseOpen('requested', new Date('2026-11-09T00:00:00.000Z'), now), false);
});

test('explanation labels preserve human review semantics', () => {
  assert.equal(explanationStatusLabel('requested'), 'Awaiting student response');
  assert.equal(explanationStatusLabel('responded'), 'Response received');
  assert.equal(explanationStatusLabel('follow_up'), 'Additional information requested');
  assert.equal(explanationStatusLabel('closed', 'accepted'), 'Explanation accepted');
});

test('decisions map to incident review states without automatic punishment', () => {
  assert.equal(incidentStatusForExplanation('accepted'), 'resolved');
  assert.equal(incidentStatusForExplanation('dismissed'), 'dismissed');
  assert.equal(incidentStatusForExplanation('escalated'), 'escalated');
  assert.equal(incidentStatusForExplanation('follow_up'), 'awaiting_student');
});

test('deadlines must be future and no more than thirty days away', () => {
  assert.equal(validExplanationDeadline(new Date('2026-11-11T00:00:00.000Z'), now), true);
  assert.equal(validExplanationDeadline(new Date('2026-11-09T00:00:00.000Z'), now), false);
  assert.equal(validExplanationDeadline(new Date('2026-12-11T00:00:00.000Z'), now), false);
});
