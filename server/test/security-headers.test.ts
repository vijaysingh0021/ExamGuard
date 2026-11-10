import assert from 'node:assert/strict';
import test from 'node:test';
import { securityHeaders } from '../src/security-headers.js';

const run = (path: string) => { const h: Record<string, string> = {}; let next = false; securityHeaders({ path }, { setHeader: (k, v) => { h[k] = v; } }, () => { next = true; }); return { h, next }; };
test('API responses are non-cacheable and hardened, and the chain continues', () => {
  const { h, next } = run('/api/notifications');
  assert.equal(next, true); assert.equal(h['Cache-Control'], 'no-store'); assert.equal(h['X-Content-Type-Options'], 'nosniff'); assert.match(h['Content-Security-Policy'], /frame-ancestors 'none'/);
});
test('non-API paths still get hardening headers but are not forced to no-store', () => {
  const { h } = run('/health'); assert.equal(h['Cache-Control'], undefined); assert.equal(h['X-Frame-Options'], 'DENY');
});
