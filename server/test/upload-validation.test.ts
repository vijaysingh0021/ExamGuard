import test from 'node:test';
import assert from 'node:assert/strict';
import { createMocks } from 'node-mocks-http';
import { validateFileContent } from '../src/app.js';

// Valid file magic bytes
const VALID_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const VALID_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const VALID_WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

// Invalid file magic bytes
const INVALID_JPEG = Buffer.from([0x00, 0x00, 0x00, 0x00]);
const INVALID_PNG = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
const INVALID_WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

function createMockRequest(file?: { mimetype: string; buffer: Buffer }) {
  const { req, res } = createMocks({
    method: 'POST',
    url: '/api/student/attempts/test/evidence',
  });

  if (file) {
    // Mimic Multer's file object structure (Express.Multer.File)
    req.file = {
      fieldname: 'file',
      originalname: 'test.jpg',
      encoding: '7bit',
      mimetype: file.mimetype,
      buffer: file.buffer,
      size: file.buffer.length,
      stream: undefined,
      destination: '',
      filename: 'test.jpg',
      path: '',
    } as any;
  } else {
    req.file = undefined;
  }

  return { req, res };
}

test('validateFileContent rejects missing file', () => {
  const { req, res } = createMockRequest();
  validateFileContent(req as any, res as any, () => {});
  assert.equal(res._getStatusCode(), 400);
  assert.ok(res._getJSONData().error.includes('No file uploaded'));
});

test('validateFileContent rejects empty file buffer', () => {
  const { req, res } = createMockRequest({ mimetype: 'image/jpeg', buffer: Buffer.from([]) });
  validateFileContent(req as any, res as any, () => {});
  assert.equal(res._getStatusCode(), 400);
  assert.ok(res._getJSONData().error.includes('Invalid file'));
});

test('validateFileContent rejects unsupported MIME type', () => {
  const { req, res } = createMockRequest({ mimetype: 'image/gif', buffer: Buffer.from([0xff, 0xd8, 0xff]) });
  validateFileContent(req as any, res as any, () => {});
  assert.equal(res._getStatusCode(), 415);
  assert.ok(res._getJSONData().error.includes('Unsupported file type'));
});

test('validateFileContent accepts valid JPEG', () => {
  const { req, res } = createMockRequest({ mimetype: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) });
  let nextCalled = false;
  validateFileContent(req as any, res as any, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res._getStatusCode(), 200);
});

test('validateFileContent rejects invalid JPEG content', () => {
  const { req, res } = createMockRequest({ mimetype: 'image/jpeg', buffer: Buffer.from([0x00, 0x00, 0x00, 0x00]) });
  validateFileContent(req as any, res as any, () => {});
  assert.equal(res._getStatusCode(), 422);
  assert.ok(res._getJSONData().error.includes('Invalid JPEG'));
});

test('validateFileContent accepts valid PNG', () => {
  const { req, res } = createMockRequest({ mimetype: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) });
  let nextCalled = false;
  validateFileContent(req as any, res as any, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res._getStatusCode(), 200);
});

test('validateFileContent rejects invalid PNG content', () => {
  const { req, res } = createMockRequest({ mimetype: 'image/png', buffer: Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]) });
  validateFileContent(req as any, res as any, () => {});
  assert.equal(res._getStatusCode(), 422);
  assert.ok(res._getJSONData().error.includes('Invalid PNG'));
});

test('validateFileContent accepts valid WebP', () => {
  const { req, res } = createMockRequest({ mimetype: 'image/webp', buffer: Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]) });
  let nextCalled = false;
  validateFileContent(req as any, res as any, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res._getStatusCode(), 200);
});

test('validateFileContent rejects invalid WebP content', () => {
  const { req, res } = createMockRequest({ mimetype: 'image/webp', buffer: Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]) });
  validateFileContent(req as any, res as any, () => {});
  assert.equal(res._getStatusCode(), 422);
  assert.ok(res._getJSONData().error.includes('Invalid WebP'));
});

test('validateFileContent rejects MIME spoofing (JPEG header with PNG MIME)', () => {
  const { req, res } = createMockRequest({ mimetype: 'image/png', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) });
  validateFileContent(req as any, res as any, () => {});
  assert.equal(res._getStatusCode(), 422);
  assert.ok(res._getJSONData().error.includes('Invalid PNG'));
});