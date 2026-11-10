import assert from 'node:assert/strict';
import test from 'node:test';
import { QUIET_AFTER_MS, companionConnection } from '../src/companion.js';

const now = new Date('2026-11-07T10:00:00Z'); const ago = (ms: number) => new Date(now.getTime() - ms);
test('no report means not connected, with pairing guidance', () => {
  const r = companionConnection(null, now); assert.equal(r.state, 'not_connected'); assert.equal(r.lastReportAt, null); assert.match(r.message, /pair/i);
});
test('recent active report is connected; old report is quiet, never "disconnected"', () => {
  assert.equal(companionConnection({ observedAt: ago(10_000), scannerStatus: 'active' }, now).state, 'connected');
  assert.equal(companionConnection({ observedAt: ago(QUIET_AFTER_MS), scannerStatus: 'active' }, now).state, 'connected');
  const q = companionConnection({ observedAt: ago(QUIET_AFTER_MS + 1), scannerStatus: null }, now);
  assert.equal(q.state, 'quiet'); assert.match(q.message, /not a finding/); assert.ok(!/disconnect|cheat|violation/i.test(q.message));
});
test('candidate-initiated stop is respected and described as such', () => {
  const r = companionConnection({ observedAt: ago(5000), scannerStatus: 'stopped' }, now); assert.equal(r.state, 'stopped_by_candidate'); assert.ok(!/violation|suspicious/i.test(r.message));
});
test('scanner problems are reported as technical, with remedies', () => {
  for (const s of ['permission_denied', 'unavailable', 'error']) { const r = companionConnection({ observedAt: ago(1000), scannerStatus: s }, now); assert.equal(r.state, 'scanner_problem'); assert.match(r.message, /Bluetooth or Wi-Fi/); }
});
