import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realStorage, verifyLocalEvidenceToken } from '../src/storage.js';

test('local evidence is private, metadata-backed and delivered by a short-lived signed URL', async () => {
  const previousRoot = process.env.LOCAL_EVIDENCE_DIR;
  const previousSecret = process.env.JWT_SECRET;
  const previousApiBase = process.env.API_BASE_URL;
  const directory = await mkdtemp(join(tmpdir(), 'examguard-evidence-'));
  process.env.LOCAL_EVIDENCE_DIR = directory;
  process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-local-evidence';
  process.env.API_BASE_URL = 'http://localhost:4000';
  try {
    const key = 'organizations/org/attempts/attempt/evidence/frame.jpg';
    const body = Buffer.from('test-image-bytes');
    await realStorage.putPrivateDocument(key, body, 'image/jpeg');
    assert.equal(realStorage.storageConfigured(), true);
    assert.deepEqual(await realStorage.privateDocumentMetadata?.(key), { contentType: 'image/jpeg', contentLength: body.length });
    assert.deepEqual(await realStorage.getPrivateDocument?.(key), body);
    const url = await realStorage.privateDocumentUrl(key, 'image/jpeg', 60);
    const token = url.split('/').at(-1)!;
    assert.equal(verifyLocalEvidenceToken(token), key);
  } finally {
    if (previousRoot === undefined) delete process.env.LOCAL_EVIDENCE_DIR; else process.env.LOCAL_EVIDENCE_DIR = previousRoot;
    if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret;
    if (previousApiBase === undefined) delete process.env.API_BASE_URL; else process.env.API_BASE_URL = previousApiBase;
    await rm(directory, { recursive: true, force: true });
  }
});

test('local evidence rejects directory traversal keys', async () => {
  const previousRoot = process.env.LOCAL_EVIDENCE_DIR;
  const previousSecret = process.env.JWT_SECRET;
  const directory = await mkdtemp(join(tmpdir(), 'examguard-evidence-'));
  process.env.LOCAL_EVIDENCE_DIR = directory;
  process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-local-evidence';
  try {
    await assert.rejects(() => realStorage.putPrivateDocument('../outside.jpg', Buffer.from('x'), 'image/jpeg'));
  } finally {
    if (previousRoot === undefined) delete process.env.LOCAL_EVIDENCE_DIR; else process.env.LOCAL_EVIDENCE_DIR = previousRoot;
    if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret;
    await rm(directory, { recursive: true, force: true });
  }
});
