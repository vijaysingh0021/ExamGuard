import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { AddressInfo, Server } from 'node:net';
import { createApp } from '../src/app.js';
import { signToken } from '../src/auth.js';
import { prisma } from '../src/prisma.js';

test('assistant routes authorize organization roles and return grounded or refused responses', async () => {
  const previousEnvironment = {
    JWT_SECRET: process.env.JWT_SECRET,
    CLIENT_URL: process.env.CLIENT_URL,
    ASSISTANT_PROVIDER_URL: process.env.ASSISTANT_PROVIDER_URL,
    ASSISTANT_MODEL: process.env.ASSISTANT_MODEL,
    ASSISTANT_API_KEY: process.env.ASSISTANT_API_KEY,
    ASSISTANT_EXTERNAL_DATA_POLICY_APPROVED: process.env.ASSISTANT_EXTERNAL_DATA_POLICY_APPROVED,
  };
  const secret = 'assistant-route-test-secret-at-least-32-characters';
  const organizationId = randomUUID();
  const outsiderOrganizationId = randomUUID();
  const teacherId = randomUUID();
  const adminId = randomUUID();
  const proctorId = randomUUID();
  const outsiderId = randomUUID();
  const suffix = randomUUID();
  let server: Server | undefined;
  let databaseReady = false;

  const restoreEnvironment = () => {
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  const stopServer = (instance: Server) => new Promise<void>((resolve, reject) => {
    instance.close(error => error ? reject(error) : resolve());
  });

  try {
    process.env.JWT_SECRET = secret;
    process.env.CLIENT_URL = 'http://localhost:5173';
    delete process.env.ASSISTANT_PROVIDER_URL;
    delete process.env.ASSISTANT_MODEL;
    delete process.env.ASSISTANT_API_KEY;
    delete process.env.ASSISTANT_EXTERNAL_DATA_POLICY_APPROVED;

    const connection = await prisma.$queryRaw<Array<{ databaseName: string }>>`
      SELECT current_database() AS "databaseName"
    `;
    assert.equal(connection[0]?.databaseName, 'examguard_test');
    databaseReady = true;

    await prisma.organization.createMany({ data: [
      { id: organizationId, name: `Assistant test ${suffix}`, slug: `assistant-test-${suffix}` },
      { id: outsiderOrganizationId, name: `Assistant outsider ${suffix}`, slug: `assistant-outsider-${suffix}` },
    ] });
    await prisma.user.createMany({ data: [
      { id: teacherId, name: 'Assistant test teacher', email: `teacher-${suffix}@example.test`, passwordHash: 'not-used' },
      { id: adminId, name: 'Assistant test administrator', email: `admin-${suffix}@example.test`, passwordHash: 'not-used' },
      { id: proctorId, name: 'Assistant test proctor', email: `proctor-${suffix}@example.test`, passwordHash: 'not-used' },
      { id: outsiderId, name: 'Assistant test outsider', email: `outsider-${suffix}@example.test`, passwordHash: 'not-used' },
    ] });
    await prisma.membership.createMany({ data: [
      { userId: teacherId, organizationId, role: 'teacher', active: true },
      { userId: adminId, organizationId, role: 'institute_admin', active: true },
      { userId: proctorId, organizationId, role: 'proctor', active: true },
      { userId: outsiderId, organizationId: outsiderOrganizationId, role: 'teacher', active: true },
    ] });

    server = createApp().listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const headersFor = (userId: string) => ({
      Authorization: `Bearer ${signToken(userId)}`,
      'Content-Type': 'application/json',
    });
    const statusPath = `/api/organizations/${organizationId}/assistant/status`;
    const chatPath = `/api/organizations/${organizationId}/assistant/chat`;

    assert.equal((await fetch(`${baseUrl}${statusPath}`)).status, 401);
    const outsiderStatus = await fetch(`${baseUrl}${statusPath}`, { headers: headersFor(outsiderId) });
    assert.equal(outsiderStatus.status, 403);

    for (const userId of [teacherId, adminId, proctorId]) {
      const status = await fetch(`${baseUrl}${statusPath}`, { headers: headersFor(userId) });
      assert.equal(status.status, 200);
      assert.deepEqual(await status.json(), {
        mode: 'help_center',
        providerConfigured: false,
        conversationsStored: false,
      });

      const allowed = await fetch(`${baseUrl}${chatPath}`, {
        method: 'POST',
        headers: headersFor(userId),
        body: JSON.stringify({ message: 'How do I sign in to ExamGuard?' }),
      });
      assert.equal(allowed.status, 200);
      const allowedBody = await allowed.json() as { mode?: string; sources?: unknown[] };
      assert.equal(allowedBody.mode, 'knowledge');
      assert.ok(Array.isArray(allowedBody.sources) && allowedBody.sources.length > 0);

      const refused = await fetch(`${baseUrl}${chatPath}`, {
        method: 'POST',
        headers: headersFor(userId),
        body: JSON.stringify({ message: 'How can I bypass the proctoring camera?' }),
      });
      assert.equal(refused.status, 200);
      const refusedBody = await refused.json() as { mode?: string; intent?: string };
      assert.equal(refusedBody.mode, 'refused');
      assert.equal(refusedBody.intent, 'bypass');
    }

    const analytics = await fetch(`${baseUrl}${chatPath}`, {
      method: 'POST',
      headers: headersFor(adminId),
      body: JSON.stringify({ message: 'Summarize the exam analytics' }),
    });
    assert.equal(analytics.status, 200);
    const analyticsBody = await analytics.json() as { sources?: Array<{ id?: string }> };
    assert.ok(analyticsBody.sources?.some(source => source.id === 'organization-data'));

    const invalidRequest = await fetch(`${baseUrl}${chatPath}`, {
      method: 'POST',
      headers: headersFor(teacherId),
      body: JSON.stringify({ message: '' }),
    });
    assert.equal(invalidRequest.status, 400);
  } finally {
    try {
      if (server?.listening) await stopServer(server);
    } finally {
      try {
        if (databaseReady) {
          await prisma.auditLog.deleteMany({ where: { organizationId: { in: [organizationId, outsiderOrganizationId] } } });
          await prisma.membership.deleteMany({ where: { userId: { in: [teacherId, adminId, proctorId, outsiderId] } } });
          await prisma.user.deleteMany({ where: { id: { in: [teacherId, adminId, proctorId, outsiderId] } } });
          await prisma.organization.deleteMany({ where: { id: { in: [organizationId, outsiderOrganizationId] } } });
        }
      } finally {
        restoreEnvironment();
      }
    }
  }
});
