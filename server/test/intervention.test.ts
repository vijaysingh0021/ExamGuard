import test from 'node:test'; import assert from 'node:assert/strict';
import { interventionFor } from '../src/intervention.js';
const policy = { windowSeconds: 300, warningAt: 1, pauseAt: 3, terminateAt: 5, automaticTerminationEnabled: false };
test('first suspicious signal warns, repeated signals pause, and termination is opt-in', () => { assert.equal(interventionFor(policy, 'visibility_hidden', 1), 'warning'); assert.equal(interventionFor(policy, 'visibility_hidden', 3), 'paused'); assert.equal(interventionFor(policy, 'visibility_hidden', 5), 'paused'); assert.equal(interventionFor({ ...policy, automaticTerminationEnabled: true }, 'visibility_hidden', 5), 'terminated'); });
test('technical interruptions are recorded without an automated exam intervention', () => { assert.equal(interventionFor({ ...policy, automaticTerminationEnabled: true }, 'network_interruption', 10), 'technical'); assert.equal(interventionFor(policy, 'camera_permission_lost', 10), 'technical'); });
