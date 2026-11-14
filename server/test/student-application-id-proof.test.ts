import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { signToken } from '../src/auth.js';
import { prisma } from '../src/prisma.js';
import type { StorageInterface } from '../src/storage.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const candidateId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const instituteAdminId = '44444444-4444-4444-8444-444444444444';
const challengeId = '55555555-5555-4555-8555-555555555555';
const applicationId = '66666666-6666-4666-8666-666666666666';
const idDocumentBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const overrides: Array<() => void> = [];
let server: ReturnType<import('express').Express['listen']>;
let origin: string;
let storedKey = '';
let storedBytes: Buffer | undefined;
const verificationData: Array<Record<string, unknown>> = [];
let auditAction = '';
let forceMissingIdDocument = false;

function stub(target: object, method: string, implementation: unknown) {
  const record = target as Record<string, unknown>;
  const previous = Object.getOwnPropertyDescriptor(record, method);
  Object.defineProperty(record, method, { configurable: true, writable: true, value: implementation });
  overrides.push(() => {
    if (previous) Object.defineProperty(record, method, previous);
    else delete record[method];
  });
}

const storage: StorageInterface = {
  storageConfigured: () => true,
  putPrivateDocument: async (key, body) => {
    storedKey = key;
    storedBytes = body;
    return key;
  },
  privateDocumentUrl: async key => `https://private.example/${encodeURIComponent(key)}`,
};

test.before(async () => {
  stub(prisma.organization, 'findFirst', async () => ({ id: organizationId }));
  stub(prisma.user, 'findUnique', async () => null);
  stub(prisma.candidate, 'findUnique', async () => null);
  stub(prisma.signupEmailChallenge, 'findFirst', async () => ({ id: challengeId }));
  stub(prisma.signupEmailChallenge, 'updateMany', async () => ({ count: 1 }));
  stub(prisma.user, 'create', async () => ({ id: userId }));
  stub(prisma.membership, 'create', async () => ({}));
  stub(prisma.membership, 'findFirst', async (query: unknown) => {
    const userIdInQuery = (query as { where: { userId: string } }).where.userId;
    return userIdInQuery === instituteAdminId
      ? { organizationId, role: 'institute_admin', active: true }
      : null;
  });
  stub(prisma.candidate, 'create', async () => ({ id: candidateId }));
  stub(prisma.verificationRequest, 'create', async (query: unknown) => {
    verificationData.push((query as { data: Record<string, unknown> }).data);
    return { id: applicationId };
  });
  stub(prisma.verificationRequest, 'findFirst', async (query: unknown) => {
    const where = (query as { where: { id: string; organizationId: string } }).where;
    return where.id === applicationId && where.organizationId === organizationId
      ? { idDocument: forceMissingIdDocument ? null : storedKey, candidate: { userId } }
      : null;
  });
  stub(prisma.auditLog, 'create', async (query: unknown) => {
    auditAction = (query as { data: { action: string } }).data.action;
    return {};
  });
  stub(prisma, '$transaction', async (operation: unknown) => {
    if (typeof operation !== 'function') throw new Error('Expected an interactive transaction');
    return operation(prisma);
  });

  server = createApp(storage).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  for (const restore of overrides.reverse()) restore();
});

test('student applications require private ID proof and allow only institution administrators to view it', async () => {
  const endpoint = `${origin}/api/public/student-applications`;
  const fields = {
    name: 'Student Example',
    email: 'student@example.test',
    password: 'StrongStudentPass2026!',
    organizationId,
    verificationTicket: 'verified-email-ticket-with-sufficient-length-1234567890',
  };
  const missingDocument = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  assert.equal(missingDocument.status, 400);
  assert.equal(verificationData.length, 0);

  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append('idDocument', new Blob([idDocumentBytes], { type: 'image/png' }), 'government-id.png');
  const submission = await fetch(endpoint, { method: 'POST', body: form });
  assert.equal(submission.status, 201);
  assert.equal(verificationData[0]?.idDocument, storedKey);
  assert.deepEqual(storedBytes, idDocumentBytes);
  assert.equal(auditAction, 'student_application.submitted');

  forceMissingIdDocument = true;
  const approvalWithoutProof = await fetch(`${origin}/api/organizations/${organizationId}/student-applications/${applicationId}/decision`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${signToken(instituteAdminId)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'approve' }),
  });
  forceMissingIdDocument = false;
  assert.equal(approvalWithoutProof.status, 409);

  const proofResponse = await fetch(`${origin}/api/organizations/${organizationId}/student-applications/${applicationId}/documents/idDocument`, {
    headers: { Authorization: `Bearer ${signToken(instituteAdminId)}` },
  });
  assert.equal(proofResponse.status, 200);
  assert.equal((await proofResponse.json() as { url: string }).url, `https://private.example/${encodeURIComponent(storedKey)}`);
  assert.equal(auditAction, 'student_application.document_viewed');

  const unauthorized = await fetch(`${origin}/api/organizations/${organizationId}/student-applications/${applicationId}/documents/idDocument`, {
    headers: { Authorization: `Bearer ${signToken(userId)}` },
  });
  assert.equal(unauthorized.status, 403);
});
