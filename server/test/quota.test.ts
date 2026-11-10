import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateQuota, parseQuotaBytes } from '../src/quota.js';

const MB = 1024 * 1024;
test('no quota configured means unlimited and always allowed', () => {
  assert.deepEqual(evaluateQuota({ usedBytes: 5 * MB, incomingBytes: MB }), { status: 'unlimited', allowed: true, percentUsed: null });
});
test('quota: ok, warning near the limit, and full rejects without freeing space', () => {
  assert.equal(evaluateQuota({ usedBytes: 10 * MB, incomingBytes: MB, quotaBytes: 100 * MB }).status, 'ok');
  assert.equal(evaluateQuota({ usedBytes: 80 * MB, incomingBytes: 0, quotaBytes: 100 * MB }).status, 'warning');
  const full = evaluateQuota({ usedBytes: 99 * MB, incomingBytes: 2 * MB, quotaBytes: 100 * MB });
  assert.equal(full.allowed, false); assert.equal(full.status, 'full');
  assert.equal(evaluateQuota({ usedBytes: 99 * MB, incomingBytes: MB, quotaBytes: 100 * MB }).allowed, true, 'exactly at the limit is allowed');
});
test('quota config is validated', () => {
  assert.equal(parseQuotaBytes(undefined), undefined); assert.equal(parseQuotaBytes('0'), undefined); assert.equal(parseQuotaBytes('-5'), undefined); assert.equal(parseQuotaBytes('abc'), undefined);
  assert.equal(parseQuotaBytes('2'), 2 * MB);
});
