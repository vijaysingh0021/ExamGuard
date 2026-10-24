import test from 'node:test'; import assert from 'node:assert/strict'; import { examToJson } from '../src/serializers.js';
test('exam responses nest the intervention policy and never expose the access code hash', () => {
  const json = examToJson({ id: 'e1', title: 'Midterm', accessCodeHash: 'secret-hash', policyWindowSeconds: 300, policyWarningAt: 1, policyPauseAt: 3, policyTerminateAt: 5, policyAutomaticTerminationEnabled: false, policyFullscreenRequired: true } as never);
  assert.deepEqual(json.interventionPolicy, { windowSeconds: 300, warningAt: 1, pauseAt: 3, terminateAt: 5, automaticTerminationEnabled: false, fullscreenRequired: true });
  assert.equal(json.hasAccessCode, true);
  assert.equal('accessCodeHash' in json, false);
  assert.equal('policyPauseAt' in json, false);
});