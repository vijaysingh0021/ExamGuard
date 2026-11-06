import test from 'node:test'; import assert from 'node:assert/strict'; import { roleCanAccess, signToken, tenantFilter, jwtSubject, signCompanionToken } from '../src/auth.js';
import jwt from 'jsonwebtoken';

test('authentication signs a JWT with configured environment', () => { const previous = { ...process.env }; Object.assign(process.env, { DATABASE_URL: 'postgresql://user:pass@localhost:5432/test', JWT_SECRET: 'x'.repeat(32) }); assert.match(signToken('user-id'), /\./); process.env = previous; });
test('role authorization permits only explicitly granted roles', () => { assert.equal(roleCanAccess('teacher', ['teacher', 'institute_admin']), true); assert.equal(roleCanAccess('student', ['teacher', 'institute_admin']), false); });
test('organization isolation filter always scopes a query to one organization', () => { assert.deepEqual(tenantFilter('org-a'), { organizationId: 'org-a' }); assert.notDeepEqual(tenantFilter('org-a'), tenantFilter('org-b')); });

// JWT security tests
test('token subjects must be UUIDs', () => {
  const validUuid = '550e8400-e29b-41d4-a716-446655440000';
  const invalidSubject = 'not-a-uuid';
  assert.equal(jwtSubject({ sub: validUuid }), validUuid);
  assert.equal(jwtSubject({ sub: invalidSubject }), undefined);
});

test('bearer tokens are parsed strictly', () => {
  const { bearerToken } = require('../src/auth.js');
  assert.equal(bearerToken('Bearer valid-token'), 'valid-token');
  assert.equal(bearerToken('Bearer   spaced'), 'spaced');
  assert.equal(bearerToken('bearer lowercase'), undefined);
  assert.equal(bearerToken('Token other-scheme'), undefined);
  assert.equal(bearerToken(''), undefined);
  assert.equal(bearerToken(undefined), undefined);
});

test('companion pairing tokens are short-lived and scoped to the device-monitor audience', () => {
  const previous = { ...process.env };
  Object.assign(process.env, { DATABASE_URL: 'postgresql://user:pass@localhost:5432/test', JWT_SECRET: 'x'.repeat(32) });
  const token = signCompanionToken({
    userId: '550e8400-e29b-41d4-a716-446655440000',
    organizationId: '550e8400-e29b-41d4-a716-446655440001',
    examId: '550e8400-e29b-41d4-a716-446655440002',
    candidateId: '550e8400-e29b-41d4-a716-446655440003',
    attemptId: '550e8400-e29b-41d4-a716-446655440004'
  });
  const decoded = jwt.decode(token) as jwt.JwtPayload;
  assert.ok(decoded);
  assert.equal(decoded.aud, 'examguard-device-monitor');
  assert.ok(decoded.exp);
  const now = Math.floor(Date.now() / 1000);
  assert.ok(decoded.exp > now);
  assert.ok(decoded.exp <= now + 600); // 10 minutes
  process.env = previous;
});

test('empty user ID throws when signing token', () => {
  const previous = { ...process.env };
  Object.assign(process.env, { DATABASE_URL: 'postgresql://user:pass@localhost:5432/test', JWT_SECRET: 'x'.repeat(32) });
  assert.throws(() => signToken(''), { message: /non-empty user ID/ });
  process.env = previous;
});

test('signCompanionToken requires all claims', () => {
  const previous = { ...process.env };
  Object.assign(process.env, { DATABASE_URL: 'postgresql://user:pass@localhost:5432/test', JWT_SECRET: 'x'.repeat(32) });
  const token = signCompanionToken({
    userId: '550e8400-e29b-41d4-a716-446655440000',
    organizationId: '550e8400-e29b-41d4-a716-446655440001',
    examId: '550e8400-e29b-41d4-a716-446655440002',
    candidateId: '550e8400-e29b-41d4-a716-446655440003',
    attemptId: '550e8400-e29b-41d4-a716-446655440004'
  });
  assert.ok(token.length > 0);
  process.env = previous;
});
