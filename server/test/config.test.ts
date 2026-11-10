import test from 'node:test'; import assert from 'node:assert/strict'; import { loadConfig } from '../src/config.js';
import { isSupportedImage, isSupportedIdentityDocument } from '../src/upload-validation.js';

test('requires PostgreSQL configuration', () => assert.throws(() => loadConfig({ DATABASE_URL: '', JWT_SECRET: '' })));
test('accepts PostgreSQL configuration', () => assert.equal(loadConfig({ DATABASE_URL: 'postgresql://user:pass@localhost:5432/test', JWT_SECRET: 'a'.repeat(32) }).DATABASE_URL, 'postgresql://user:pass@localhost:5432/test'));
test('rejects a non-PostgreSQL database URL', () => assert.throws(() => loadConfig({ DATABASE_URL: 'mysql://localhost/test', JWT_SECRET: 'a'.repeat(32) })));

// File upload validation tests
test('JPEG magic bytes validation', () => {
  const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  assert.equal(isSupportedImage('image/jpeg', jpegHeader), true);

  const invalidJpeg = Buffer.from([0x00, 0x00, 0x00, 0x00]);
  assert.equal(isSupportedImage('image/jpeg', invalidJpeg), false);
});

test('PNG magic bytes validation', () => {
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(isSupportedImage('image/png', pngHeader), true);

  const invalidPng = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  assert.equal(isSupportedImage('image/png', invalidPng), false);
});

test('WebP magic bytes validation', () => {
  const webpHeader = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
  assert.equal(isSupportedImage('image/webp', webpHeader), true);

  const invalidWebp = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  assert.equal(isSupportedImage('image/webp', invalidWebp), false);
});

test('PDF magic bytes validation', () => {
  const pdfHeader = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
  assert.equal(isSupportedIdentityDocument('application/pdf', pdfHeader), true);

  const invalidPdf = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]);
  assert.equal(isSupportedIdentityDocument('application/pdf', invalidPdf), false);
});

test('rejects unsupported MIME types', () => {
  const buffer = Buffer.from([0xff, 0xd8, 0xff]);
  assert.equal(isSupportedImage('image/gif', buffer), false);
  assert.equal(isSupportedIdentityDocument('application/msword', buffer), false);
});