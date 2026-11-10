import assert from 'node:assert/strict';
import test from 'node:test';
import { HOUR, bucketKey, parseRetentionDays, receiptCodeFor, reminderWindow, retentionCutoff, timeDrivenExamStatus } from '../src/lifecycle.js';

const now = new Date('2026-11-07T10:00:00Z');
const at = (ms: number) => new Date(now.getTime() + ms);

test('reminder windows: nearest only, never past or too early', () => {
  assert.equal(reminderWindow(at(30 * 60_000), now), '1h');
  assert.equal(reminderWindow(at(HOUR), now), '1h');
  assert.equal(reminderWindow(at(HOUR + 1), now), '24h');
  assert.equal(reminderWindow(at(24 * HOUR), now), '24h');
  assert.equal(reminderWindow(at(24 * HOUR + 1), now), null);
  assert.equal(reminderWindow(at(0), now), null);
  assert.equal(reminderWindow(at(-1000), now), null);
});
test('receipt code matches the submit-route format', () => {
  const id = '11111111-1111-4111-8111-abcdef123456';
  assert.match(receiptCodeFor(id, now), /^EG-123456-[0-9A-Z]+$/);
  assert.equal(receiptCodeFor(id, now), receiptCodeFor(id, now));
});
test('bucket keys are stable inside a bucket and change across buckets', () => {
  assert.equal(bucketKey('sweep', at(1000), 60_000), bucketKey('sweep', at(2000), 60_000));
  assert.notEqual(bucketKey('sweep', now, 60_000), bucketKey('sweep', at(61_000), 60_000));
});
test('retention config is validated and cutoffs are exact', () => {
  assert.equal(parseRetentionDays(undefined), undefined); assert.equal(parseRetentionDays('0'), undefined);
  assert.equal(parseRetentionDays('abc'), undefined); assert.equal(parseRetentionDays('90'), 90);
  assert.equal(retentionCutoff(now, 1).toISOString(), '2026-11-06T10:00:00.000Z');
});
test('exam status follows time but never completes while attempts are open', () => {
  assert.equal(timeDrivenExamStatus({ status: 'scheduled', startsAt: at(-1) }, now, false), 'live');
  assert.equal(timeDrivenExamStatus({ status: 'scheduled', startsAt: at(HOUR) }, now, false), undefined);
  assert.equal(timeDrivenExamStatus({ status: 'live', startsAt: at(-2 * HOUR), endsAt: at(-1) }, now, false), 'completed');
  assert.equal(timeDrivenExamStatus({ status: 'live', startsAt: at(-2 * HOUR), endsAt: at(-1) }, now, true), undefined);
  assert.equal(timeDrivenExamStatus({ status: 'scheduled', startsAt: at(-HOUR), endsAt: at(-1) }, now, false), 'completed');
  assert.equal(timeDrivenExamStatus({ status: 'draft', endsAt: at(-1) }, now, false), undefined, 'drafts are never touched');
  assert.equal(timeDrivenExamStatus({ status: 'completed', endsAt: at(-1) }, now, false), undefined);
});
