import assert from 'node:assert/strict';
import test from 'node:test';
import { assistantAccessRoles, assistantRoleFor } from '../src/ops-routes.js';

test('platform administrators can use the assistant through their verified organization membership', () => {
  assert.ok(assistantAccessRoles.includes('platform_admin'));
  assert.equal(assistantRoleFor('platform_admin'), 'admin');
  assert.equal(assistantRoleFor('student'), 'candidate');
  assert.equal(assistantRoleFor('unknown-role'), undefined);
});
