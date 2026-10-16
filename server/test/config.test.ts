import test from 'node:test'; import assert from 'node:assert/strict'; import { loadConfig } from '../src/config.js';
test('requires Atlas configuration', () => assert.throws(() => loadConfig({ MONGODB_URI: '', MONGODB_DB_NAME: '', JWT_SECRET: '' })));
test('accepts Atlas configuration', () => assert.equal(loadConfig({ MONGODB_URI: 'mongodb+srv://user:pass@cluster/test', MONGODB_DB_NAME: 'test', JWT_SECRET: 'a'.repeat(32) }).MONGODB_DB_NAME, 'test'));
