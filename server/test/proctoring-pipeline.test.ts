import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { signToken } from '../src/auth.js';
import { prisma } from '../src/prisma.js';
import type { StorageInterface } from '../src/storage.js';

const userId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';
const examId = '33333333-3333-4333-8333-333333333333';
const candidateId = '44444444-4444-4444-8444-444444444444';
const attemptId = '55555555-5555-4555-8555-555555555555';
const parentEventId = '66666666-6666-4666-8666-666666666666';
const otherId = '77777777-7777-4777-8777-777777777777';
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

type Stub = { target: object; name: string; previous?: PropertyDescriptor };
const restoreStubs = (stubs: Stub[]) => {
  for (const { target, name, previous } of stubs.reverse()) {
    const record = target as Record<string, unknown>;
    if (previous) Object.defineProperty(record, name, previous);
    else delete record[name];
  }
};

function installStub(stubs: Stub[], target: object, name: string, value: unknown) {
  const record = target as Record<string, unknown>;
  const previous = Object.getOwnPropertyDescriptor(record, name);
  stubs.push({ target, name, previous });
  Object.defineProperty(record, name, { configurable: true, writable: true, value });
}

function makeFixture() {
  const stubs: Stub[] = [];
  const frames: Array<Record<string, any>> = [];
  const storedKeys: string[] = [];
  const parentOccurredAt = new Date(Date.now() - 2_000);
  const parent = {
    id: parentEventId,
    organizationId,
    attemptId,
    candidateId,
    examId,
    source: 'ai_service',
    evidenceKey: `organizations/${organizationId}/attempts/${attemptId}/evidence/parent.jpg`,
    occurredAt: parentOccurredAt,
    incidents: [{ incidentId: randomUUID() }],
  };
  const attemptRecord: Record<string, any> = {
    id: attemptId,
    organizationId,
    examId,
    candidateId,
    userId,
    status: 'in_progress',
    deadlineAt: new Date(Date.now() + 60_000),
    monitoringConsentAt: new Date(),
    monitoringConsentVersion: 'examguard-monitoring-v2',
  };
  let activeAttempt: Record<string, any> | null = attemptRecord;
  let transactionTail = Promise.resolve();
  const storage: StorageInterface = {
    storageConfigured: () => true,
    putPrivateDocument: async key => { storedKeys.push(key); return `mocked://${key}`; },
    privateDocumentUrl: async key => `mocked://${key}`,
  };

  installStub(stubs, prisma.examAttempt, 'findFirst', async ({ where }: { where: Record<string, any> }) => {
    const attempt = activeAttempt;
    return attempt &&
      where.id === attempt.id &&
      (!where.organizationId || where.organizationId === attempt.organizationId) &&
      where.userId === attempt.userId &&
      where.status === attempt.status &&
      where.status === 'in_progress' &&
      where.deadlineAt?.gt instanceof Date &&
      attempt.deadlineAt > where.deadlineAt.gt
      ? attempt
      : null;
  });
  installStub(stubs, prisma.candidate, 'findFirst', async ({ where }: { where: Record<string, any> }) =>
    where.id === candidateId && where.organizationId === organizationId && where.userId === userId
      ? { id: candidateId, organizationId, userId }
      : null,
  );
  installStub(stubs, prisma.exam, 'findFirst', async ({ where }: { where: Record<string, any> }) =>
    where.id === examId && where.organizationId === organizationId
      ? { id: examId, organizationId, policyWindowSeconds: 300, policyWarningAt: 1, policyPauseAt: 3, policyTerminateAt: 5 }
      : null,
  );
  installStub(stubs, prisma.proctoringConfig, 'upsert', async () => ({ cooldownSeconds: 30, signalWeights: {} }));
  installStub(stubs, prisma.proctoringEvent, 'count', async () => 0);
  installStub(stubs, prisma.proctoringEvent, 'findFirst', async ({ where }: { where: Record<string, any> }) => {
    if (where.id === parentEventId) return parent;
    return frames.find(frame =>
      frame.organizationId === where.organizationId &&
      frame.attemptId === where.attemptId &&
      frame.fingerprint === where.fingerprint,
    ) ?? null;
  });
  installStub(stubs, prisma.proctoringEvent, 'findMany', async ({ where }: { where: Record<string, any> }) =>
    frames.filter(frame =>
      frame.organizationId === where.organizationId &&
      frame.attemptId === where.attemptId &&
      frame.details.parentEventId === where.details.equals,
    ),
  );
  installStub(stubs, prisma.proctoringEvent, 'create', async ({ data }: { data: Record<string, any> }) => {
    const event = { id: randomUUID(), ...data };
    frames.push(event);
    return event;
  });
  installStub(stubs, prisma.incident, 'create', async () => ({ id: randomUUID() }));
  installStub(stubs, prisma.incidentEvent, 'createMany', async () => ({ count: 1 }));
  installStub(stubs, prisma.evidenceObject, 'aggregate', async () => ({ _sum: { sizeBytes: 0 } }));
  installStub(stubs, prisma.evidenceObject, 'create', async ({ data }: { data: Record<string, unknown> }) => data);
  installStub(stubs, prisma.auditLog, 'create', async ({ data }: { data: Record<string, unknown> }) => data);
  installStub(stubs, prisma, '$queryRaw', async () => []);
  installStub(stubs, prisma, '$transaction', async (callback: (tx: typeof prisma) => Promise<unknown>) => {
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    const previous = transactionTail;
    transactionTail = previous.then(() => current);
    await previous;
    try {
      return await callback(prisma);
    } finally {
      release();
    }
  });

  return {
    stubs,
    frames,
    storedKeys,
    parent,
    attemptRecord,
    storage,
    setActiveAttempt(value: Record<string, any> | null) { activeAttempt = value; },
  };
}

async function withServer(
  storage: StorageInterface,
  run: (baseUrl: string) => Promise<void>,
) {
  const server = createApp(storage).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

async function postEvent(baseUrl: string, body: Record<string, unknown>, requestOrganizationId = organizationId) {
  const response = await fetch(`${baseUrl}/api/organizations/${requestOrganizationId}/proctoring/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${signToken(userId)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function postContext(
  baseUrl: string,
  values: { parentEventId?: string; contextType: 'before' | 'after'; sequence: number; capturedAt: Date },
) {
  const form = new FormData();
  form.append('parentEventId', values.parentEventId ?? parentEventId);
  form.append('contextType', values.contextType);
  form.append('sequence', String(values.sequence));
  form.append('capturedAt', values.capturedAt.toISOString());
  form.append('frame', new Blob([jpeg], { type: 'image/jpeg' }), 'context.jpg');
  const response = await fetch(`${baseUrl}/api/student/attempts/${attemptId}/ai-context-frame`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${signToken(userId)}` },
    body: form,
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function postAiFrame(baseUrl: string) {
  const form = new FormData();
  form.append('frame', new Blob([jpeg], { type: 'image/jpeg' }), 'camera.jpg');
  const response = await fetch(`${baseUrl}/api/student/attempts/${attemptId}/ai-frame`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${signToken(userId)}` },
    body: form,
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

test('proctoring events require the authenticated user’s active, unexpired attempt context', async () => {
  const fixture = makeFixture();
  try {
    await withServer(fixture.storage, async baseUrl => {
      const event = {
        examId,
        candidateId,
        attemptId,
        type: 'visibility_hidden',
        occurredAt: new Date().toISOString(),
        source: 'browser',
      };
      const valid = await postEvent(baseUrl, event);
      assert.equal(valid.status, 201);

      const wrongCandidate = await postEvent(baseUrl, { ...event, candidateId: otherId });
      assert.equal(wrongCandidate.status, 403);

      const wrongOrganization = await postEvent(baseUrl, event, otherId);
      assert.equal(wrongOrganization.status, 403);

      fixture.setActiveAttempt({ ...fixture.attemptRecord, userId: otherId });
      const unauthorized = await postEvent(baseUrl, event);
      assert.equal(unauthorized.status, 403);

      fixture.setActiveAttempt({ ...fixture.attemptRecord, status: 'submitted' });
      const submitted = await postEvent(baseUrl, event);
      assert.equal(submitted.status, 403);

      fixture.setActiveAttempt({ ...fixture.attemptRecord, deadlineAt: new Date(Date.now() - 1_000) });
      const expired = await postEvent(baseUrl, event);
      assert.equal(expired.status, 403);

      assert.equal(fixture.frames.filter(frame => frame.type !== 'ai_context_frame').length, 1);
    });
  } finally {
    restoreStubs(fixture.stubs);
  }
});

test('AI frames use the configured service credential and are not recorded after attempt closure', async () => {
  const fixture = makeFixture();
  const previousEnvironment = {
    NODE_ENV: process.env.NODE_ENV,
    AI_SERVICE_URL: process.env.AI_SERVICE_URL,
    AI_SERVICE_TOKEN: process.env.AI_SERVICE_TOKEN,
  };
  const originalFetch = globalThis.fetch;
  const serviceToken = randomUUID().repeat(3);
  const serviceRequests: Array<{ url: string; authorization: string | null }> = [];
  let closeAttemptAfterInference = false;
  process.env.NODE_ENV = 'production';
  process.env.AI_SERVICE_URL = 'https://ai-test.run.app';
  process.env.AI_SERVICE_TOKEN = serviceToken;
  globalThis.fetch = async (input, init) => {
    if (String(input) !== 'https://ai-test.run.app/analyze') return originalFetch(input, init);
    serviceRequests.push({ url: String(input), authorization: new Headers(init?.headers).get('authorization') });
    if (closeAttemptAfterInference) fixture.setActiveAttempt(null);
    return new Response(JSON.stringify({
      face_presence: true,
      face_count: 1,
      face_boxes: [],
      face_pose_estimates: [],
      multiple_faces: false,
      looking_away: 'looking_forward',
      phone_detection: 'not_detected',
      phone_boxes: [],
      visible_devices: [],
      camera_health: 'ok',
      frame_quality: { mean_luminance: 100, luminance_stddev: 20 },
      inference_ms: 10,
      inference_stages_ms: {
        image_decode_ms: 1,
        resize_ms: 1,
        face_detection_ms: 2,
        head_pose_ms: 2,
        phone_detection_ms: 2,
        postprocessing_ms: 1,
        total_ms: 10,
      },
      latency_summary_ms: {
        p50_ms: 10,
        p95_ms: null,
        p99_ms: null,
        count: 1,
        percentile_method: { p50: 'median', p95: 'nearest_rank', p99: 'nearest_rank' },
        minimum_samples: { p50: 1, p95: 20, p99: 100 },
      },
      service_version: 'pipeline-test',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await withServer(fixture.storage, async baseUrl => {
      const accepted = await postAiFrame(baseUrl);
      assert.equal(accepted.status, 200);
      assert.deepEqual(
        (accepted.body.analysis as Record<string, unknown>).latency_summary_ms,
        {
          p50_ms: 10,
          p95_ms: null,
          p99_ms: null,
          count: 1,
          percentile_method: { p50: 'median', p95: 'nearest_rank', p99: 'nearest_rank' },
          minimum_samples: { p50: 1, p95: 20, p99: 100 },
        },
      );
      assert.deepEqual(serviceRequests[0], {
        url: 'https://ai-test.run.app/analyze',
        authorization: `Bearer ${serviceToken}`,
      });

      closeAttemptAfterInference = true;
      const closedDuringInference = await postAiFrame(baseUrl);
      assert.equal(closedDuringInference.status, 409);
      assert.equal(fixture.storedKeys.length, 0);
      assert.equal(serviceRequests.length, 2);
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    restoreStubs(fixture.stubs);
  }
});

test('AI face-count limit errors are surfaced and over-limit success responses are rejected', async () => {
  const fixture = makeFixture();
  const previousEnvironment = {
    NODE_ENV: process.env.NODE_ENV,
    AI_SERVICE_URL: process.env.AI_SERVICE_URL,
    AI_SERVICE_TOKEN: process.env.AI_SERVICE_TOKEN,
  };
  const originalFetch = globalThis.fetch;
  const serviceToken = randomUUID().repeat(3);
  let responseMode: 'limit_error' | 'max_supported_success' | 'legacy_no_telemetry' | 'invalid_face_array' | 'over_limit_success' = 'max_supported_success';
  process.env.NODE_ENV = 'production';
  process.env.AI_SERVICE_URL = 'https://ai-test.run.app';
  process.env.AI_SERVICE_TOKEN = serviceToken;
  globalThis.fetch = async (input, init) => {
    if (String(input) !== 'https://ai-test.run.app/analyze') return originalFetch(input, init);
    if (responseMode === 'limit_error') {
      return new Response(JSON.stringify({
        detail: {
          code: 'face_count_limit_exceeded',
          detected_face_count: 21,
          max_face_count: 20,
          message: 'Frame contains 21 detected faces, exceeding the supported maximum of 20; no detections were truncated.',
        },
      }), { status: 422, headers: { 'Content-Type': 'application/json' } });
    }
    const faceBoxCount = responseMode === 'max_supported_success'
      ? 20
      : responseMode === 'legacy_no_telemetry' ? 1 : 21;
    const faceBoxes = Array.from({ length: faceBoxCount }, (_, index) => ({
      x: (index % 5) * 0.18,
      y: Math.floor(index / 5) * 0.18,
      width: 0.15,
      height: 0.15,
      confidence: 0.9,
    }));
    const faceCount = responseMode === 'invalid_face_array' ? 20 : faceBoxes.length;
    return new Response(JSON.stringify({
      face_presence: true,
      face_count: faceCount,
      face_boxes: faceBoxes,
      face_pose_estimates: faceBoxes.slice(0, faceCount).map(face_box => ({
        face_box,
        head_pose: null,
        looking_away: 'unavailable',
      })),
      multiple_faces: faceCount > 1,
      looking_away: faceCount === 1 ? 'looking_forward' : 'unavailable',
      phone_detection: 'not_detected',
      phone_boxes: [],
      visible_devices: [],
      camera_health: 'ok',
      frame_quality: { mean_luminance: 100, luminance_stddev: 20 },
      ...(responseMode !== 'legacy_no_telemetry' ? {
        inference_ms: 10,
        inference_stages_ms: { face_detection_ms: 5, head_pose_ms: 3, total_ms: 10 },
        latency_summary_ms: {
          p50_ms: 10,
          p95_ms: null,
          p99_ms: null,
          count: 1,
          percentile_method: { p50: 'median', p95: 'nearest_rank', p99: 'nearest_rank' },
          minimum_samples: { p50: 1, p95: 20, p99: 100 },
        },
      } : {}),
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    await withServer(fixture.storage, async baseUrl => {
      const maximumSupported = await postAiFrame(baseUrl);
      assert.ok([200, 201, 202].includes(maximumSupported.status));
      assert.equal(
        (maximumSupported.body.analysis as Record<string, unknown>).face_count,
        20,
      );
      const recordedFrames = fixture.frames.length;
      const storedEvidence = fixture.storedKeys.length;

      responseMode = 'legacy_no_telemetry';
      const legacyResponse = await postAiFrame(baseUrl);
      assert.equal(legacyResponse.status, 200);
      const legacyAnalysis = legacyResponse.body.analysis as Record<string, unknown>;
      assert.equal(legacyAnalysis.face_count, 1);
      assert.equal('inference_ms' in legacyAnalysis, false);
      assert.equal('inference_stages_ms' in legacyAnalysis, false);
      assert.equal('latency_summary_ms' in legacyAnalysis, false);

      responseMode = 'invalid_face_array';
      const invalidArray = await postAiFrame(baseUrl);
      assert.equal(invalidArray.status, 502);
      assert.equal(invalidArray.body.code, 'face_count_contract_violation');
      assert.equal(invalidArray.body.maxFaceCount, 20);

      responseMode = 'limit_error';
      const tooManyFaces = await postAiFrame(baseUrl);
      assert.equal(tooManyFaces.status, 422);
      assert.equal(tooManyFaces.body.code, 'face_count_limit_exceeded');
      assert.equal(tooManyFaces.body.detectedFaceCount, 21);
      assert.equal(tooManyFaces.body.maxFaceCount, 20);
      assert.match(String(tooManyFaces.body.error), /No detections were truncated/);

      responseMode = 'over_limit_success';
      const invalidSuccess = await postAiFrame(baseUrl);
      assert.equal(invalidSuccess.status, 502);
      assert.equal(invalidSuccess.body.code, 'face_count_contract_violation');
      assert.equal(invalidSuccess.body.maxFaceCount, 20);
      assert.match(String(invalidSuccess.body.error), /no analysis was recorded/);

      assert.equal(fixture.frames.length, recordedFrames);
      assert.equal(fixture.storedKeys.length, storedEvidence);
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    restoreStubs(fixture.stubs);
  }
});

test('context frames require a valid parent and before-context frame, and are idempotent and ordered', async () => {
  const fixture = makeFixture();
  try {
    await withServer(fixture.storage, async baseUrl => {
      const tooEarlyAfter = await postContext(baseUrl, {
        contextType: 'after',
        sequence: 0,
        capturedAt: new Date(fixture.parent.occurredAt.getTime() + 100),
      });
      assert.equal(tooEarlyAfter.status, 409);

      const invalidParent = await postContext(baseUrl, {
        parentEventId: otherId,
        contextType: 'before',
        sequence: 0,
        capturedAt: new Date(fixture.parent.occurredAt.getTime() - 100),
      });
      assert.equal(invalidParent.status, 404, JSON.stringify(invalidParent.body));
      assert.equal(fixture.storedKeys.length, 0);

      const outsideAfterWindow = await postContext(baseUrl, {
        contextType: 'after',
        sequence: 0,
        capturedAt: new Date(fixture.parent.occurredAt.getTime() + 6_000),
      });
      assert.equal(outsideAfterWindow.status, 400);
      assert.equal(outsideAfterWindow.body.error, 'An after-context frame must follow the incident and remain within five seconds');
      const beforeIncident = await postContext(baseUrl, {
        contextType: 'after',
        sequence: 0,
        capturedAt: new Date(fixture.parent.occurredAt.getTime() - 100),
      });
      assert.equal(beforeIncident.status, 400);
      assert.equal(beforeIncident.body.error, 'An after-context frame must follow the incident and remain within five seconds');
      assert.equal(fixture.storedKeys.length, 0);

      const beforeTime = new Date(fixture.parent.occurredAt.getTime() - 1_000);
      const before = await postContext(baseUrl, { contextType: 'before', sequence: 0, capturedAt: beforeTime });
      assert.equal(before.status, 201);

      const afterTime = new Date(fixture.parent.occurredAt.getTime() + 100);
      const duplicateRetries = await Promise.all([
        postContext(baseUrl, { contextType: 'after', sequence: 0, capturedAt: afterTime }),
        postContext(baseUrl, { contextType: 'after', sequence: 0, capturedAt: afterTime }),
      ]);
      assert.deepEqual(duplicateRetries.map(result => result.status).sort(), [200, 201]);
      assert.equal(fixture.storedKeys.length, 2);

      const outOfOrder = await postContext(baseUrl, {
        contextType: 'after',
        sequence: 2,
        capturedAt: new Date(fixture.parent.occurredAt.getTime() + 300),
      });
      assert.equal(outOfOrder.status, 409);

      const concurrent = await Promise.all([
        postContext(baseUrl, { contextType: 'after', sequence: 1, capturedAt: new Date(fixture.parent.occurredAt.getTime() + 200) }),
        postContext(baseUrl, { contextType: 'after', sequence: 2, capturedAt: new Date(fixture.parent.occurredAt.getTime() + 300) }),
      ]);
      const orderedFrames = fixture.frames
        .filter(frame => frame.type === 'ai_context_frame' && frame.details.contextType === 'after')
        .sort((left, right) => left.details.sequence - right.details.sequence);
      if (concurrent.some(result => result.status === 409)) {
        const missing = concurrent.find(result => result.status === 409);
        assert.ok(missing);
      }
      const nextSequence = orderedFrames.length;
      const retrySequence = concurrent.some(result => result.status === 409) ? nextSequence : null;
      if (retrySequence !== null) {
        const retry = await postContext(baseUrl, {
          contextType: 'after',
          sequence: retrySequence,
          capturedAt: new Date(fixture.parent.occurredAt.getTime() + (retrySequence + 1) * 100),
        });
        assert.equal(retry.status, 201);
      }
      assert.deepEqual(
        fixture.frames.filter(frame => frame.type === 'ai_context_frame' && frame.details.contextType === 'after')
          .map(frame => frame.details.sequence).sort((left, right) => left - right),
        Array.from({ length: fixture.frames.filter(frame => frame.type === 'ai_context_frame' && frame.details.contextType === 'after').length }, (_, index) => index),
      );
    });
  } finally {
    restoreStubs(fixture.stubs);
  }
});
