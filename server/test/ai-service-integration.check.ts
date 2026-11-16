import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { createApp } from '../src/app.js';
import { signToken } from '../src/auth.js';
import { prisma } from '../src/prisma.js';

const userId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '22222222-2222-4222-8222-222222222222';
const organizationId = '33333333-3333-4333-8333-333333333333';
const examId = '44444444-4444-4444-8444-444444444444';
const candidateId = '55555555-5555-4555-8555-555555555555';
const attemptId = '66666666-6666-4666-8666-666666666666';
const token = process.env.AI_SERVICE_TOKEN ?? '';
assert.ok(token.length >= 32, 'AI_SERVICE_TOKEN must be configured');
const integrationAiUrl = 'http://127.0.0.1:8002';
const repositoryRoot = resolve(__dirname, '..', '..');

const attempt = {
  id: attemptId,
  userId,
  organizationId,
  examId,
  candidateId,
  status: 'in_progress',
  deadlineAt: new Date(Date.now() + 60_000),
  monitoringConsentAt: new Date(),
  monitoringConsentVersion: 'examguard-monitoring-v2',
};
const testStorage = {
  storageConfigured: () => true,
  verifyReadiness: async () => undefined,
  putPrivateDocument: async (key: string) => key,
  privateDocumentUrl: async () => '',
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

let consent = true;
let heartbeat = true;
const storedEvidence: string[] = [];
const events: Array<Record<string, unknown>> = [];
const incidents: Array<Record<string, unknown>> = [];

stub(prisma.examAttempt, 'findFirst', async (query: unknown) => {
  const where = (query as { where: Record<string, unknown> }).where;
  return where.id === attemptId && where.userId === userId
    ? { ...attempt, monitoringConsentAt: consent ? attempt.monitoringConsentAt : null }
    : null;
});
stub(prisma.radioObservation, 'findFirst', async () => heartbeat ? { id: 'heartbeat' } : null);
stub(prisma.radioObservation, 'findMany', async () => [{
  source: 'bluetooth_le',
  kind: 'advertisement',
  rssi: -58,
  pseudonym: 'session-device-pseudonym',
  advertisedName: 'Nearby Device',
  observedAt: new Date(),
}]);
stub(prisma.proctoringConfig, 'upsert', async () => ({
  cooldownSeconds: 30,
  signalWeights: { face_missing: 15 },
}));
stub(prisma.exam, 'findUniqueOrThrow', async () => ({
  policyWindowSeconds: 300,
  policyWarningAt: 1,
  policyPauseAt: 3,
  policyTerminateAt: 5,
  policyAutomaticTerminationEnabled: false,
  policyFullscreenRequired: false,
}));
stub(prisma.proctoringEvent, 'findFirst', async () => null);
stub(prisma.proctoringEvent, 'count', async () => 0);
stub(prisma.proctoringEvent, 'create', async (input: unknown) => {
  const data = (input as { data: Record<string, unknown> }).data;
  events.push(data);
  return { id: `event-${events.length}`, ...data };
});
stub(prisma.evidenceObject, 'aggregate', async () => ({ _sum: { sizeBytes: 0 } }));
stub(prisma.evidenceObject, 'create', async (input: unknown) => {
  const data = (input as { data: { objectKey: string } }).data;
  storedEvidence.push(data.objectKey);
  return data;
});
stub(prisma.incident, 'create', async (input: unknown) => {
  const data = (input as { data: Record<string, unknown> }).data;
  incidents.push(data);
  return { id: `incident-${incidents.length}` };
});
stub(prisma.auditLog, 'create', async () => ({}));

async function main() {
const previousUrl = process.env.AI_SERVICE_URL;
const previousToken = process.env.AI_SERVICE_TOKEN;
const previousNodeEnv = process.env.NODE_ENV;
const originalFetch = globalThis.fetch;
process.env.NODE_ENV = 'test';
process.env.AI_SERVICE_URL = integrationAiUrl;
const server = createApp(testStorage).listen(0, '127.0.0.1');

try {
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const image = await readFile(resolve(repositoryRoot, 'ai-service', 'camera_test.jpg'));
  const faceBox = { x: 0.1, y: 0.2, width: 0.3, height: 0.4, confidence: 0.93 };
  const mockAiAnalysis = {
    face_presence: true,
    face_count: 1,
    face_boxes: [faceBox],
    face_pose_estimates: [{
      face_box: faceBox,
      head_pose: { yaw_degrees: 0, pitch_degrees: 0, roll_degrees: 0 },
      looking_away: 'looking_forward',
    }],
    multiple_faces: false,
    looking_away: 'looking_forward',
    head_pose: { yaw_degrees: 0, pitch_degrees: 0, roll_degrees: 0 },
    phone_detection: 'not_detected',
    phone_confidence: null,
    phone_boxes: [],
    visible_devices: [],
    camera_health: 'ok',
  };
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/health/ready')) {
      return new Headers(init?.headers).get('authorization') === `Bearer ${token}`
        ? Response.json({ mediapipe: 'ready', phone_model: 'ready', looking_away: 'ready', multiple_faces: 'ready' })
        : new Response(null, { status: 401 });
    }
    if (url.endsWith('/analyze')) {
      assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${token}`);
      return Response.json(mockAiAnalysis);
    }
    return originalFetch(input, init);
  };

  const getReadiness = (authorization?: string) => fetch(`${baseUrl}/api/student/monitoring-readiness`, {
    headers: authorization ? { Authorization: authorization } : {},
  });
  assert.equal((await getReadiness()).status, 401);
  const readiness = await getReadiness(`Bearer ${signToken(userId)}`);
  assert.equal(readiness.status, 200);
  assert.equal((await readiness.json() as { ready: boolean }).ready, true);

  process.env.AI_SERVICE_TOKEN = `${token}mismatch`;
  const mismatch = await getReadiness(`Bearer ${signToken(userId)}`);
  assert.equal(mismatch.status, 503);
  const mismatchResult = await mismatch.json() as { checks: Array<{ id: string; status: string; explanation: string }>; error: string };
  assert.equal(mismatchResult.checks.find(check => check.id === 'ai_service')?.status, 'failed');
  assert.match(mismatchResult.error, /credentials do not match/i);
  process.env.AI_SERVICE_TOKEN = token;

  const sendFrame = (authorization: string, filename = 'frame.jpg') => {
    const form = new FormData();
    form.append('frame', new Blob([image], { type: 'image/jpeg' }), filename);
    return fetch(`${baseUrl}/api/student/attempts/${attemptId}/ai-frame`, {
      method: 'POST',
      headers: { Authorization: authorization },
      body: form,
    });
  };
  assert.equal((await sendFrame(`Bearer ${signToken(otherUserId)}`)).status, 409);

  consent = false;
  assert.equal((await sendFrame(`Bearer ${signToken(userId)}`)).status, 403);
  consent = true;
  heartbeat = false;
  const actualInference = await sendFrame(`Bearer ${signToken(userId)}`);
  assert.equal(actualInference.status, 200);
  heartbeat = true;
  const actualResult = await actualInference.json() as {
    analysis: {
      face_count: number;
      face_boxes: unknown[];
      face_pose_estimates: Array<{ looking_away: string }>;
      looking_away: string;
      head_pose?: { pitch_degrees: number } | null;
      phone_detection: string;
      phone_confidence: number | null;
      phone_boxes: unknown[];
    };
    recorded: unknown[];
    evidenceAttached: boolean;
  };
  assert.equal(actualResult.analysis.face_count, 1);
  assert.equal(actualResult.analysis.face_boxes.length, 1);
  assert.ok(Array.isArray(actualResult.analysis.face_pose_estimates));
  if (actualResult.analysis.face_pose_estimates.length) {
    assert.equal(actualResult.analysis.face_pose_estimates.length, 1);
    assert.equal(actualResult.analysis.face_pose_estimates[0].looking_away, 'looking_forward');
  }
  assert.equal(actualResult.analysis.looking_away, 'looking_forward');
  assert.ok(actualResult.analysis.head_pose);
  assert.equal(actualResult.analysis.phone_detection, 'not_detected');
  assert.equal(actualResult.analysis.phone_confidence, null);
  assert.deepEqual(actualResult.analysis.phone_boxes, []);
  assert.equal(actualResult.recorded.length, 0);
  assert.equal(actualResult.evidenceAttached, false);
  assert.equal(events.length, 0);
  assert.equal(incidents.length, 0);

  let simulatedAnalysis: Record<string, unknown> = {
    face_presence: true,
    face_count: 2,
    face_boxes: [
      { x: 0.1, y: 0.2, width: 0.2, height: 0.3, confidence: 0.93 },
      { x: 0.6, y: 0.2, width: 0.2, height: 0.3, confidence: 0.89 },
    ],
    face_pose_estimates: [
      {
        face_box: { x: 0.1, y: 0.2, width: 0.2, height: 0.3, confidence: 0.93 },
        head_pose: { yaw_degrees: 42, pitch_degrees: 0, roll_degrees: 0 },
        looking_away: 'looking_away',
      },
      {
        face_box: { x: 0.6, y: 0.2, width: 0.2, height: 0.3, confidence: 0.89 },
        head_pose: { yaw_degrees: 0, pitch_degrees: 0, roll_degrees: 0 },
        looking_away: 'looking_forward',
      },
    ],
    multiple_faces: true,
    looking_away: 'unavailable',
    head_pose: null,
    phone_detection: 'detected',
    phone_confidence: 0.91,
    phone_boxes: [{ x1: 120, y1: 100, x2: 260, y2: 320, confidence: 0.91, label: 'cell phone' }],
    camera_health: 'ok',
    frame_quality: { mean_luminance: 100, luminance_stddev: 50 },
    inference_ms: 10,
    service_version: 'integration-mock',
    phone_model: 'configured',
    visible_devices: [{
      kind: 'laptop',
      label: 'laptop',
      confidence: 0.88,
      box: [180, 90, 520, 360],
    }],
    readability_assessment: {
      status: 'potentially_readable',
      confidence: 'low',
      basis: 'Mocked screen and face-relative heuristic',
      devices: [{
        kind: 'laptop',
        label: 'laptop',
        confidence: 0.88,
        box: [180, 90, 520, 360],
        visible: true,
        estimated_distance_band: 'medium',
        screen_bearing_from_face_degrees: 4.2,
        view_alignment: 'roughly_aligned',
        estimated_text_height_px: 9,
        potentially_readable: true,
      }],
      limitations: 'Mocked inference only',
    },
  };
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).endsWith('/analyze')) {
      assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${token}`);
      return new Response(JSON.stringify(simulatedAnalysis), { status: 200 });
    }
    return originalFetch(input, init);
  };

  const firstPositive = await sendFrame(`Bearer ${signToken(userId)}`);
  assert.equal(firstPositive.status, 200);
  assert.deepEqual((await firstPositive.json() as { recorded: unknown[] }).recorded, []);
  const secondPositive = await sendFrame(`Bearer ${signToken(userId)}`);
  assert.equal(secondPositive.status, 200);
  assert.deepEqual((await secondPositive.json() as { recorded: unknown[] }).recorded, []);
  const confirmed = await sendFrame(`Bearer ${signToken(userId)}`);
  assert.equal(confirmed.status, 201);
  const confirmedResult = await confirmed.json() as {
    evidenceAttached: boolean;
    recorded: Array<{ type: string; eventId: string; incidentId: string }>;
  };
  assert.equal(confirmedResult.evidenceAttached, true);
  assert.deepEqual(
    confirmedResult.recorded.map(signal => signal.type).sort(),
    ['multiple_faces', 'phone_detected', 'potential_visual_assistance'].sort(),
  );
  assert.equal(events.length, 3);
  assert.equal(incidents.length, 3);
  const eventByType = new Map(events.map(event => [event.type, event]));
  const phoneEvent = eventByType.get('phone_detected');
  assert.ok(phoneEvent);
  assert.equal(phoneEvent.organizationId, organizationId);
  assert.equal(phoneEvent.attemptId, attemptId);
  assert.equal(phoneEvent.policyAction, 'recorded');
  const phoneDetails = phoneEvent.details as Record<string, unknown>;
  assert.equal(phoneDetails.faceCount, 2);
  assert.equal(phoneDetails.phoneConfidence, 0.91);
  assert.equal((phoneDetails.faceBoxes as unknown[]).length, 2);
  assert.equal((phoneDetails.facePoseEstimates as unknown[]).length, 2);
  assert.equal((phoneDetails.phoneBoxes as unknown[]).length, 1);
  assert.equal(phoneDetails.temporalConfirmation, '3_of_5_frames');
  assert.equal(eventByType.has('looking_away'), false);
  const phoneSignal = confirmedResult.recorded.find(signal => signal.type === 'phone_detected');
  assert.equal((incidents.find(incident => incident.type === 'phone_detected')?.events as { create: { eventId: string } }).create.eventId, phoneSignal?.eventId);
  for (const signal of confirmedResult.recorded) {
    const event = events.find(candidate => candidate.type === signal.type);
    assert.ok(event);
    assert.equal(storedEvidence.includes(event.evidenceKey as string), true);
  }
  const visualEvent = eventByType.get('potential_visual_assistance');
  assert.ok(visualEvent);
  const screenEventDetails = visualEvent.details as Record<string, unknown>;
  assert.equal((screenEventDetails.potentialVisualAssistance as { flagged: boolean }).flagged, true);
  assert.equal((screenEventDetails.proximityObservations as Array<{ advertisedName: string }>)[0]?.advertisedName, 'Nearby Device');
  assert.equal((screenEventDetails.proximityObservations as Array<{ association: string }>)[0]?.association, 'temporal_only_device_not_linked');

  simulatedAnalysis = {
    face_presence: true,
    face_count: 1,
    face_boxes: [{ x: 0.35, y: 0.2, width: 0.3, height: 0.4, confidence: 0.95 }],
    face_pose_estimates: [{
      face_box: { x: 0.35, y: 0.2, width: 0.3, height: 0.4, confidence: 0.95 },
      head_pose: { yaw_degrees: 42, pitch_degrees: 0, roll_degrees: 0 },
      looking_away: 'looking_away',
    }],
    multiple_faces: false,
    looking_away: 'looking_away',
    head_pose: { yaw_degrees: 42, pitch_degrees: 0, roll_degrees: 0 },
    phone_detection: 'not_detected',
    camera_health: 'ok',
    frame_quality: { mean_luminance: 100, luminance_stddev: 50 },
    inference_ms: 10,
    service_version: 'integration-mock',
    phone_model: 'configured',
    visible_devices: [],
  };
  for (let frameNumber = 0; frameNumber < 2; frameNumber++) {
    const response = await sendFrame(`Bearer ${signToken(userId)}`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json() as { recorded: unknown[] }).recorded, []);
  }
  const singleFaceConfirmed = await sendFrame(`Bearer ${signToken(userId)}`);
  assert.equal(singleFaceConfirmed.status, 201);
  assert.deepEqual(
    (await singleFaceConfirmed.json() as { recorded: Array<{ type: string }> }).recorded.map(signal => signal.type),
    ['looking_away'],
  );
  assert.equal(events.length, 4);
  assert.equal(incidents.length, 4);
  const lookingAwayEvent = events.find(event => event.type === 'looking_away');
  assert.ok(lookingAwayEvent);
  assert.equal(((lookingAwayEvent.details as Record<string, unknown>).facePoseEstimates as unknown[]).length, 1);
  console.log('AI backend integration passed: authenticated readiness and analysis contract; ownership/consent and heartbeat-independent browser monitoring; simulated AI signal mapping; 3-of-5 confirmation; event details, mocked evidence storage, and radio correlation. No database used.');
} finally {
  globalThis.fetch = originalFetch;
  if (previousUrl === undefined) delete process.env.AI_SERVICE_URL;
  else process.env.AI_SERVICE_URL = previousUrl;
  if (previousToken === undefined) delete process.env.AI_SERVICE_TOKEN;
  else process.env.AI_SERVICE_TOKEN = previousToken;
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  for (const restore of overrides.reverse()) restore();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await prisma.$disconnect();
}
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
