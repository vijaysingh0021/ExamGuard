import test from 'node:test'; import assert from 'node:assert/strict';
import { createResetToken, hashResetToken, passwordPolicy } from '../src/password-reset.js';
test('password reset tokens are high-entropy, hashable, and never need persistence in plaintext', () => { const token = createResetToken(); assert.ok(token.length >= 40); assert.equal(hashResetToken(token), hashResetToken(token)); assert.notEqual(hashResetToken(token), token); });
test('password reset policy rejects weak passwords and accepts a compliant password', () => { assert.equal(passwordPolicy('short'), false); assert.equal(passwordPolicy('alllowercase123'), false); assert.equal(passwordPolicy('NoNumbersHere'), false); assert.equal(passwordPolicy('ExamGuard2026'), true); });
