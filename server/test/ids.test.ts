import test from 'node:test'; import assert from 'node:assert/strict'; import { isUuid } from '../src/ids.js';
test('isUuid accepts UUIDs only', () => {
  assert.equal(isUuid('3f2b8c1e-5a4d-4c6b-9e1a-7d2f0a9b8c11'), true);
  assert.equal(isUuid('507f1f77bcf86cd799439011'), false);
  assert.equal(isUuid(undefined), false);
  assert.equal(isUuid(['3f2b8c1e-5a4d-4c6b-9e1a-7d2f0a9b8c11']), false);
});