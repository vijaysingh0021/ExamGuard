import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { signToken } from '../src/auth.js';
import { prisma } from '../src/prisma.js';
import type { StorageInterface } from '../src/storage.js';

const userId = '11111111-1111-4111-8111-111111111111';
const organizationId = '33333333-3333-4333-8333-333333333333';
const examId = '44444444-4444-4444-8444-444444444444';
const candidateId = '55555555-5555-4555-8555-555555555555';

test('exam start returns mandatory readiness failures before creating an attempt', async () => {
  const previousEnvironment = {
    NODE_ENV: process.env.NODE_ENV,
    AI_SERVICE_URL: process.env.AI_SERVICE_URL,
    AI_SERVICE_TOKEN: process.env.AI_SERVICE_TOKEN,
  };
  const overrides: Array<() => void> = [];
  function stub(target: object, method: string, implementation: unknown) {
    const record = target as Record<string, unknown>;
    const previous = Object.getOwnPropertyDescriptor(record, method);
    Object.defineProperty(record, method, { configurable: true, writable: true, value: implementation });
    overrides.push(() => {
      if (previous) Object.defineProperty(record, method, previous);
      else delete record[method];
    });
  }

  process.env.NODE_ENV = 'production';
  process.env.AI_SERVICE_URL = 'http://127.0.0.1:8001';
  process.env.AI_SERVICE_TOKEN = 'a'.repeat(40);
  stub(prisma.candidate, 'findFirst', async () => ({ id: candidateId }));
  stub(prisma.exam, 'findFirst', async () => ({
    id: examId,
    organizationId,
    status: 'live',
    startsAt: null,
    endsAt: null,
    accessCodeHash: null,
    randomizeQuestions: false,
  }));
  stub(prisma.examAssignment, 'findUnique', async () => ({ id: 'assignment' }));
  stub(prisma, '$transaction', async () => {
    throw new Error('The attempt transaction must not run when readiness fails.');
  });
  const storage: StorageInterface = {
    storageConfigured: () => true,
    verifyReadiness: async () => undefined,
    putPrivateDocument: async key => key,
    privateDocumentUrl: async key => key,
  };
  const server = createApp(storage).listen(0, '127.0.0.1');

  try {
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/student/organizations/${organizationId}/exams/${examId}/start`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${signToken(userId)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        monitoringConsentAccepted: true,
        monitoringConsentVersion: 'examguard-monitoring-v2',
      }),
    });
    const body = await response.json() as {
      error: string;
      readiness: { ready: boolean; checks: Array<{ id: string; status: string }> };
    };

    assert.equal(response.status, 503);
    assert.match(body.error, /readiness checks have not passed/);
    assert.equal(body.readiness.ready, false);
    assert.equal(body.readiness.checks.find(check => check.id === 'ai_service')?.status, 'failed');
    assert.equal(body.readiness.checks.find(check => check.id === 'evidence_storage')?.status, 'ready');
  } finally {
    server.close();
    await once(server, 'close');
    for (const restore of overrides.reverse()) restore();
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
