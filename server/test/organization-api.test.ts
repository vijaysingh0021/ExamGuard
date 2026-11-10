import test from 'node:test';
import assert from 'node:assert/strict';
import {
  candidateListQuerySchema,
  candidateWhere,
  incidentListQuerySchema,
  incidentWhere,
  memberUpdateSchema,
  memberCanBeManaged,
  questionOrderMatches,
  wouldRemoveLastActiveAdmin,
  organizationApiRoles,
  prismaErrorResponse,
  paginationHeaders,
  paginationOffset,
  questionOrderSchema,
} from '../src/organization-api.js';

const idA = '550e8400-e29b-41d4-a716-446655440001';
const idB = '550e8400-e29b-41d4-a716-446655440002';

test('candidate pagination defaults and bounds page size', () => {
  assert.deepEqual(candidateListQuerySchema.parse({}), { page: 1, pageSize: 50, sortBy: 'name', sortOrder: 'asc' });
  assert.equal(candidateListQuerySchema.safeParse({ pageSize: 100 }).success, true);
  assert.equal(candidateListQuerySchema.safeParse({ pageSize: 101 }).success, false);
  assert.equal(candidateListQuerySchema.safeParse({ page: 0 }).success, false);
  assert.equal(candidateListQuerySchema.safeParse({ page: 10_001 }).success, false);
  assert.equal(candidateListQuerySchema.safeParse({ search: 'x'.repeat(121) }).success, false);
  assert.equal(paginationOffset(3, 25), 50);
});

test('candidate search remains tenant-scoped and searches supported fields', () => {
  const where = candidateWhere(idA, 'Vijay');
  assert.equal(where.organizationId, idA);
  assert.equal(where.OR?.length, 4);
  assert.equal(candidateListQuerySchema.safeParse({ sortBy: 'passwordHash' }).success, false);
});

test('incident filters validate ids, statuses and chronological range', () => {
  const parsed = incidentListQuerySchema.safeParse({ page: '2', pageSize: '20', candidateId: idA, examId: idB, status: 'open', eventType: 'phone_detected', from: '2026-11-01T00:00:00.000Z', to: '2026-11-06T00:00:00.000Z' });
  assert.equal(parsed.success, true);
  assert.equal(incidentListQuerySchema.safeParse({ pageSize: '100' }).success, true);
  assert.equal(incidentListQuerySchema.safeParse({ pageSize: '101' }).success, false);
  assert.equal(incidentListQuerySchema.safeParse({ candidateId: 'not-a-uuid' }).success, false);
  assert.equal(incidentListQuerySchema.safeParse({ from: '2026-11-06T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' }).success, false);
});

test('incident where clause always scopes by organization', () => {
  const filters = incidentListQuerySchema.parse({ candidateId: idA, status: 'open', eventType: 'phone_detected' });
  const where = incidentWhere(idB, filters);
  assert.equal(where.organizationId, idB);
  assert.equal(where.candidateId, idA);
  assert.deepEqual(where.events, { some: { event: { type: 'phone_detected' } } });
});

test('question reorder requires a nonempty unique UUID list', () => {
  assert.equal(questionOrderSchema.safeParse({ questionIds: [idA, idB] }).success, true);
  assert.equal(questionOrderSchema.safeParse({ questionIds: [idA, idA] }).success, false);
  assert.equal(questionOrderSchema.safeParse({ questionIds: [] }).success, false);
  assert.equal(questionOrderSchema.safeParse({ questionIds: Array.from({ length: 501 }, (_, index) => `550e8400-e29b-41d4-a716-${String(index).padStart(12, '0')}`) }).success, false);
});

test('membership updates allow only non-admin organization roles', () => {
  assert.equal(memberUpdateSchema.safeParse({ role: 'teacher' }).success, true);
  assert.equal(memberUpdateSchema.safeParse({ role: 'institute_admin' }).success, true);
  assert.equal(memberUpdateSchema.safeParse({ role: 'platform_admin' }).success, false);
  assert.equal(memberUpdateSchema.safeParse({ active: false }).success, true);
  assert.equal(memberUpdateSchema.safeParse({}).success, false);
});

test('pagination metadata is deterministic', () => {
  assert.deepEqual(paginationHeaders(2, 25, 51), { 'X-Page': '2', 'X-Page-Size': '25', 'X-Total-Count': '51', 'X-Total-Pages': '3' });
});

test('membership policy blocks self changes and platform-admin memberships', () => {
  assert.equal(memberCanBeManaged('actor', 'other', 'teacher', false), true);
  assert.equal(memberCanBeManaged('actor', 'actor', 'teacher', false), false);
  assert.equal(memberCanBeManaged('actor', 'other', 'institute_admin', false), true);
  assert.equal(memberCanBeManaged('actor', 'other', 'platform_admin', false), false);
  assert.equal(memberCanBeManaged('actor', 'other', 'teacher', true), false);
});

test('question ordering requires an exact same-exam set', () => {
  assert.equal(questionOrderMatches([idA, idB], [idB, idA]), true);
  assert.equal(questionOrderMatches([idA, idB], [idA]), false);
  assert.equal(questionOrderMatches([idA, idB], [idA, '550e8400-e29b-41d4-a716-446655440003']), false);
});

test('membership policy preserves the final active institute administrator', () => {
  assert.equal(wouldRemoveLastActiveAdmin('institute_admin', true, 'teacher', undefined, 1), true);
  assert.equal(wouldRemoveLastActiveAdmin('institute_admin', true, undefined, false, 1), true);
  assert.equal(wouldRemoveLastActiveAdmin('institute_admin', true, 'teacher', undefined, 2), false);
  assert.equal(wouldRemoveLastActiveAdmin('teacher', true, 'student', false, 1), false);
  assert.equal(wouldRemoveLastActiveAdmin('institute_admin', false, 'teacher', undefined, 1), false);
  assert.equal(wouldRemoveLastActiveAdmin('institute_admin', false, 'teacher', undefined, 0), true);
});

test('organization API role gates match the established reviewer policy', () => {
  assert.deepEqual(organizationApiRoles.candidateRead, ['institute_admin', 'teacher', 'proctor']);
  assert.deepEqual(organizationApiRoles.incidentRead, ['institute_admin', 'teacher', 'proctor']);
  assert.deepEqual(organizationApiRoles.questionManage, ['institute_admin', 'teacher']);
  assert.deepEqual(organizationApiRoles.memberManage, ['institute_admin']);
  assert.equal(organizationApiRoles.memberManage.includes('platform_admin' as never), false);
});

test('known Prisma errors map to stable HTTP responses', () => {
  assert.deepEqual(prismaErrorResponse('P2002'), { status: 409, message: 'Already exists' });
  assert.deepEqual(prismaErrorResponse('P2025'), { status: 404, message: 'Not found' });
  assert.deepEqual(prismaErrorResponse('P2003'), { status: 400, message: 'Referenced record does not exist' });
  assert.equal(prismaErrorResponse('P2034')?.status, 409);
  assert.equal(prismaErrorResponse('P9999'), undefined);
});
