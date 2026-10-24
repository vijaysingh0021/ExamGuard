import test from 'node:test'; import assert from 'node:assert/strict'; import jwt from 'jsonwebtoken';
import { bearerToken, jwtSubject, signCompanionToken } from '../src/auth.js';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('bearer tokens are parsed strictly', () => {
  assert.equal(bearerToken('Bearer abc'), 'abc');
  assert.equal(bearerToken('abc'), undefined);
  assert.equal(bearerToken('Bearer   '), undefined);
  assert.equal(bearerToken(undefined), undefined);
});
test('token subjects must be UUIDs', () => {
  assert.equal(jwtSubject({ sub: id(1) }), id(1));
  assert.equal(jwtSubject({ sub: '507f1f77bcf86cd799439011' }), undefined);
  assert.equal(jwtSubject({}), undefined);
});
test('companion pairing tokens are short-lived and scoped to the device-monitor audience', () => {
  const previous = { ...process.env };
  Object.assign(process.env, { DATABASE_URL: 'postgresql://user:pass@localhost:5432/test', JWT_SECRET: 'c'.repeat(40) });
  const token = signCompanionToken({ userId: id(1), organizationId: id(2), examId: id(3), candidateId: id(4), attemptId: id(5) });
  const payload = jwt.verify(token, 'c'.repeat(40), { audience: 'examguard-device-monitor' }) as jwt.JwtPayload;
  assert.equal(payload.sub, id(1)); assert.equal(payload.attemptId, id(5));
  assert.ok(payload.exp! - payload.iat! <= 600);
  assert.throws(() => jwt.verify(token, 'c'.repeat(40), { audience: 'someone-else' }));
  process.env = previous;
});
