import assert from 'node:assert/strict';
import test from 'node:test';
import { auditWhere, isUuidValue, parseAuditQuery, parseSubmissionQuery, projectReviewQuestion, submissionWhere } from '../src/review-api.js';

test('submission query: defaults, bounds, status and search validation', () => {
  assert.deepEqual(parseSubmissionQuery({}), { ok: true, value: { page: 1, pageSize: 25, search: undefined, status: undefined } });
  assert.deepEqual(parseSubmissionQuery({ page: '3', pageSize: '100', status: 'expired', search: '  ana ' }), { ok: true, value: { page: 3, pageSize: 100, search: 'ana', status: 'expired' } });
  for (const bad of [{ page: '0' }, { page: '-1' }, { page: '1.5' }, { page: 'x' }, { pageSize: '101' }, { status: 'deleted' }, { search: 'x'.repeat(101) }, { page: ['1'] }]) assert.equal(parseSubmissionQuery(bad).ok, false, JSON.stringify(bad));
});
test('submission where clause is always organization and exam scoped', () => {
  assert.deepEqual(submissionWhere('o', 'e', {}), { organizationId: 'o', examId: 'e' });
  assert.deepEqual(submissionWhere('o', 'e', { status: 'submitted', search: 'an' }), { organizationId: 'o', examId: 'e', status: 'submitted', candidate: { name: { contains: 'an', mode: 'insensitive' } } });
});
test('audit query: dates validated, action prefix filter, org scoped', () => {
  const ok = parseAuditQuery({ from: '2026-11-01T00:00:00Z', to: '2026-11-07T00:00:00Z', action: 'grade.' });
  assert.equal(ok.ok, true);
  assert.equal(parseAuditQuery({ from: 'nope' }).ok, false); assert.equal(parseAuditQuery({ action: 'x'.repeat(61) }).ok, false);
  assert.deepEqual(auditWhere('o', {}), { organizationId: 'o' });
  const w = auditWhere('o', { action: 'grade.', from: new Date(0) }) as any; assert.equal(w.organizationId, 'o'); assert.deepEqual(w.action, { startsWith: 'grade.' }); assert.ok(w.createdAt.gte);
});
test('uuid check', () => { assert.equal(isUuidValue('11111111-1111-4111-8111-111111111111'), true); assert.equal(isUuidValue('abc'), false); assert.equal(isUuidValue(undefined), false); });
test('review projection: answer keys only for objective questions; coding never exposes test data', () => {
  const base = { id: 'q', prompt: 'p', marks: 2, negativeMarks: 0, position: 1, options: ['a', 'b'] };
  const mcq = projectReviewQuestion({ ...base, type: 'mcq', correctAnswer: 'a' }, 'b'); assert.equal(mcq.correctAnswer, 'a'); assert.equal(mcq.objective, true); assert.equal(mcq.answer, 'b');
  const essay = projectReviewQuestion({ ...base, type: 'descriptive', correctAnswer: 'model answer' }, undefined); assert.equal(essay.correctAnswer, null); assert.equal(essay.answer, null);
  const code = projectReviewQuestion({ ...base, type: 'coding', correctAnswer: { hidden: 'x' } }, 'print(1)'); assert.equal(code.correctAnswer, null); assert.equal(code.answer, 'print(1)');
});
