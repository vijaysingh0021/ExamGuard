import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { AddressInfo, Server } from 'node:net';
import { createApp } from '../src/app.js';
import { signToken } from '../src/auth.js';
import { prisma } from '../src/prisma.js';

test('radio analysis is reviewer-only and isolated by organization and attempt', async () => {
  const previousEnvironment = {
    JWT_SECRET: process.env.JWT_SECRET,
    CLIENT_URL: process.env.CLIENT_URL,
    ASSISTANT_PROVIDER_URL: process.env.ASSISTANT_PROVIDER_URL,
    ASSISTANT_MODEL: process.env.ASSISTANT_MODEL,
    ASSISTANT_API_KEY: process.env.ASSISTANT_API_KEY,
  };
  const secret = 'radio-analysis-route-test-secret-at-least-32-characters';
  const organizationId = randomUUID();
  const outsiderOrganizationId = randomUUID();
  const teacherId = randomUUID();
  const candidateUserId = randomUUID();
  const outsiderId = randomUUID();
  const candidateId = randomUUID();
  const outsiderCandidateId = randomUUID();
  const examId = randomUUID();
  const outsiderExamId = randomUUID();
  const attemptId = randomUUID();
  const outsiderAttemptId = randomUUID();
  const suffix = randomUUID();
  let server: Server | undefined;
  let databaseReady = false;

  const restoreEnvironment = () => {
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };

  try {
    process.env.JWT_SECRET = secret;
    process.env.CLIENT_URL = 'http://localhost:5173';
    delete process.env.ASSISTANT_PROVIDER_URL;
    delete process.env.ASSISTANT_MODEL;
    delete process.env.ASSISTANT_API_KEY;

    const connection = await prisma.$queryRaw<Array<{ databaseName: string }>>`
      SELECT current_database() AS "databaseName"
    `;
    assert.equal(connection[0]?.databaseName, 'examguard_test');
    databaseReady = true;

    await prisma.organization.createMany({ data: [
      { id: organizationId, name: `Radio analysis ${suffix}`, slug: `radio-analysis-${suffix}` },
      { id: outsiderOrganizationId, name: `Radio outsider ${suffix}`, slug: `radio-outsider-${suffix}` },
    ] });
    await prisma.user.createMany({ data: [
      { id: teacherId, name: 'Radio analysis teacher', email: `radio-teacher-${suffix}@example.test`, passwordHash: 'not-used' },
      { id: candidateUserId, name: 'Radio analysis candidate', email: `radio-candidate-${suffix}@example.test`, passwordHash: 'not-used' },
      { id: outsiderId, name: 'Radio outsider', email: `radio-outsider-${suffix}@example.test`, passwordHash: 'not-used' },
    ] });
    await prisma.membership.createMany({ data: [
      { userId: teacherId, organizationId, role: 'teacher', active: true },
      { userId: candidateUserId, organizationId, role: 'student', active: true },
      { userId: outsiderId, organizationId: outsiderOrganizationId, role: 'teacher', active: true },
    ] });
    await prisma.candidate.createMany({ data: [
      { id: candidateId, organizationId, userId: candidateUserId, name: 'Radio candidate', email: `radio-candidate-${suffix}@example.test` },
      { id: outsiderCandidateId, organizationId: outsiderOrganizationId, userId: outsiderId, name: 'Other candidate', email: `radio-other-${suffix}@example.test` },
    ] });
    await prisma.exam.createMany({ data: [
      { id: examId, organizationId, title: 'Radio analysis exam', durationMinutes: 30, status: 'published', createdById: teacherId },
      { id: outsiderExamId, organizationId: outsiderOrganizationId, title: 'Other radio exam', durationMinutes: 30, status: 'published', createdById: outsiderId },
    ] });
    await prisma.examAttempt.createMany({ data: [
      {
        id: attemptId, organizationId, examId, candidateId, userId: candidateUserId, status: 'in_progress',
        startedAt: new Date(), deadlineAt: new Date(Date.now() + 30 * 60_000),
        monitoringConsentAt: new Date(), monitoringConsentVersion: 'examguard-monitoring-v2',
      },
      { id: outsiderAttemptId, organizationId: outsiderOrganizationId, examId: outsiderExamId, candidateId: outsiderCandidateId, userId: outsiderId, status: 'in_progress', startedAt: new Date(), deadlineAt: new Date(Date.now() + 30 * 60_000) },
    ] });

    const observedAt = new Date();
    await prisma.radioObservation.createMany({ data: [
      {
        organizationId, examId, candidateId, attemptId, source: 'bluetooth_le', kind: 'advertisement',
        observedAt, rssi: -58, pseudonym: 'ble-session-pseudonym-123456', advertisedName: 'Unverified name',
        scannerStatus: 'active', fingerprint: randomUUID(), limitations: 'BLE identity is unknown.',
        expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
      },
      {
        organizationId, examId, candidateId, attemptId, source: 'wifi', kind: 'access_point',
        observedAt, rssi: -71, pseudonym: 'wifi-session-pseudonym-123456',
        scannerStatus: 'active', fingerprint: randomUUID(), limitations: 'Wi-Fi observation describes an access point.',
        expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
      },
      {
        organizationId, examId, candidateId, attemptId, source: 'scanner_health', kind: 'heartbeat',
        observedAt, scannerStatus: 'active', fingerprint: randomUUID(), limitations: 'Heartbeat is not proof of detection.',
        expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
      },
      {
        organizationId: outsiderOrganizationId, examId: outsiderExamId, candidateId: outsiderCandidateId, attemptId: outsiderAttemptId,
        source: 'wifi', kind: 'access_point', observedAt, rssi: -40, pseudonym: 'other-organization-pseudonym-123456',
        scannerStatus: 'active', fingerprint: randomUUID(), limitations: 'Other organization observation.',
        expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
      },
    ] });

    server = createApp().listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const route = `/api/organizations/${organizationId}/attempts/${attemptId}/radio-analysis`;
    const headersFor = (userId: string) => ({ Authorization: `Bearer ${signToken(userId)}` });

    assert.equal((await fetch(`${baseUrl}${route}`)).status, 401);
    assert.equal((await fetch(`${baseUrl}${route}`, { headers: headersFor(candidateUserId) })).status, 403);
    assert.equal((await fetch(`${baseUrl}${route}`, { headers: headersFor(outsiderId) })).status, 403);

    const pairingResponse = await fetch(`${baseUrl}/api/student/attempts/${attemptId}/companion-pairing`, {
      method: 'POST',
      headers: headersFor(candidateUserId),
    });
    assert.equal(pairingResponse.status, 200);
    const pairing = await pairingResponse.json() as { pairingToken: string };
    assert.ok(pairing.pairingToken);

    const batchPseudonym = 'ble-batch-session-pseudonym-123456';
    const bucketStart = Math.floor(Date.now() / (5 * 60_000)) * (5 * 60_000);
    const batch = {
      organizationId,
      examId,
      candidateId,
      attemptId,
      observations: [0, 1, 2].map(index => ({
        source: 'bluetooth_le',
        kind: 'advertisement',
        observedAt: new Date(bucketStart - 120_000 + index * 30_000).toISOString(),
        rssi: -58 - index,
        pseudonym: batchPseudonym,
        scannerStatus: 'active',
      })),
    };
    const postBatch = (token: string, value: unknown) => fetch(`${baseUrl}/api/student/radio-observations/batch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
    const ingest = await postBatch(pairing.pairingToken, batch);
    assert.equal(ingest.status, 201);
    const ingestBody = await ingest.json() as { observations: Array<{ observationId: string; repeatedObservationCount: number; candidateSignalId?: string }> };
    assert.deepEqual(ingestBody.observations.map(item => item.repeatedObservationCount), [1, 2, 3]);
    assert.ok(ingestBody.observations[2].candidateSignalId);
    const signalId = ingestBody.observations[2].candidateSignalId!;

    const retry = await postBatch(pairing.pairingToken, batch);
    assert.equal(retry.status, 201);
    const retryBody = await retry.json() as { observations: Array<{ observationId: string; candidateSignalId?: string }> };
    assert.deepEqual(retryBody.observations.map(item => item.observationId), ingestBody.observations.map(item => item.observationId));
    assert.equal(retryBody.observations[2].candidateSignalId, signalId);
    assert.equal(await prisma.radioCandidateSignal.count({ where: { attemptId } }), 1);
    assert.equal(await prisma.radioSignalObservation.count({ where: { signalId } }), 3);

    const mismatchedContext = await postBatch(pairing.pairingToken, { ...batch, organizationId: outsiderOrganizationId });
    assert.equal(mismatchedContext.status, 403);
    const invalidToken = await postBatch('invalid-token', batch);
    assert.equal(invalidToken.status, 401);

    const response = await fetch(`${baseUrl}${route}`, { headers: headersFor(teacherId) });
    assert.equal(response.status, 200);
    const analysis = await response.json() as {
      radioObservationCount: number;
      conclusion: string;
      pseudonyms: Array<{ pseudonym: string; source: string; repeatedObservationCount: number }>;
      scanners: { bluetooth: { status: string }; wifi: { status: string } };
    };
    assert.equal(analysis.radioObservationCount, 5);
    assert.equal(analysis.conclusion, 'repeated_observations_same_session_pseudonym');
    assert.deepEqual(new Set(analysis.pseudonyms.map(item => item.source)), new Set(['bluetooth_le', 'wifi']));
    assert.ok(analysis.pseudonyms.every(item => !item.pseudonym.includes('other-organization')));
    assert.equal(analysis.pseudonyms.find(item => item.pseudonym === batchPseudonym)?.repeatedObservationCount, 3);
    assert.equal(analysis.scanners.bluetooth.status, 'unknown');
    assert.equal(analysis.scanners.wifi.status, 'unknown');

    const crossAttempt = await fetch(
      `${baseUrl}/api/organizations/${organizationId}/attempts/${outsiderAttemptId}/radio-analysis`,
      { headers: headersFor(teacherId) },
    );
    assert.equal(crossAttempt.status, 404);
  } finally {
    try {
      if (server?.listening) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    } finally {
      try {
        if (databaseReady) {
          await prisma.auditLog.deleteMany({ where: { organizationId: { in: [organizationId, outsiderOrganizationId] } } });
          await prisma.radioSignalObservation.deleteMany({ where: { observation: { attemptId: { in: [attemptId, outsiderAttemptId] } } } });
          await prisma.radioCandidateSignal.deleteMany({ where: { attemptId: { in: [attemptId, outsiderAttemptId] } } });
          await prisma.radioObservation.deleteMany({ where: { attemptId: { in: [attemptId, outsiderAttemptId] } } });
          await prisma.examAttempt.deleteMany({ where: { id: { in: [attemptId, outsiderAttemptId] } } });
          await prisma.candidate.deleteMany({ where: { id: { in: [candidateId, outsiderCandidateId] } } });
          await prisma.exam.deleteMany({ where: { id: { in: [examId, outsiderExamId] } } });
          await prisma.membership.deleteMany({ where: { userId: { in: [teacherId, candidateUserId, outsiderId] } } });
          await prisma.user.deleteMany({ where: { id: { in: [teacherId, candidateUserId, outsiderId] } } });
          await prisma.organization.deleteMany({ where: { id: { in: [organizationId, outsiderOrganizationId] } } });
        }
      } finally {
        restoreEnvironment();
      }
    }
  }
});
