import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app.js';

test('Express trusts exactly one proxy hop for Render', () => {
  assert.equal(createApp().get('trust proxy'), 1);
});
