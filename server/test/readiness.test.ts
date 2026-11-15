import assert from 'node:assert/strict';
import test from 'node:test';
import { checkAiService, checkEvidenceStorage, readinessCheck, readinessSummary } from '../src/readiness.js';
import type { StorageInterface } from '../src/storage.js';

const readyHealth = {
  mediapipe: 'ready',
  phone_model: 'ready',
  looking_away: 'ready',
  multiple_faces: 'ready',
};
const localEnv = {
  NODE_ENV: 'development',
  AI_SERVICE_URL: 'http://127.0.0.1:8001',
  AI_SERVICE_TOKEN: 'a'.repeat(40),
};

test('AI readiness uses authenticated health and reports verified model capabilities', async () => {
  let requestUrl = '';
  let authorization = '';
  const result = await checkAiService(localEnv, (async (input, init) => {
    requestUrl = String(input);
    authorization = new Headers(init?.headers).get('authorization') ?? '';
    return Response.json(readyHealth);
  }) as typeof fetch);

  assert.equal(requestUrl, 'http://127.0.0.1:8001/health/ready');
  assert.equal(authorization, `Bearer ${localEnv.AI_SERVICE_TOKEN}`);
  assert.equal(result.check.id, 'ai_service');
  assert.equal(result.check.status, 'ready');
  assert.ok(result.check.lastCheckedAt);
  assert.deepEqual(result.capabilities, {
    faceDetection: true,
    phoneDetection: true,
    headOrientation: true,
    multipleFaces: true,
  });
});

test('AI readiness fails closed for invalid environment URLs and mismatched auth', async () => {
  let requests = 0;
  const fetchImpl = (async () => {
    requests += 1;
    return new Response('Unauthorized', { status: 401 });
  }) as typeof fetch;
  const mismatch = await checkAiService(localEnv, fetchImpl);
  assert.equal(mismatch.check.status, 'failed');
  assert.match(mismatch.check.remediation, /same AI_SERVICE_TOKEN/);
  assert.ok(!JSON.stringify(mismatch).includes(localEnv.AI_SERVICE_TOKEN));

  const unsafeProduction = await checkAiService(
    { ...localEnv, NODE_ENV: 'production' },
    fetchImpl,
  );
  assert.equal(unsafeProduction.check.status, 'failed');
  assert.match(unsafeProduction.check.remediation, /HTTPS/);
  assert.equal(requests, 1, 'invalid production localhost URL must not be requested');
});

test('AI readiness retries one transient failure then reports unavailable', async () => {
  let requests = 0;
  const result = await checkAiService(localEnv, (async () => {
    requests += 1;
    throw new Error('network unavailable');
  }) as typeof fetch);

  assert.equal(requests, 2);
  assert.equal(result.check.status, 'unavailable');
  assert.equal(result.capabilities.phoneDetection, false);
});

test('missing AI capabilities remain unavailable rather than becoming a false negative', async () => {
  const result = await checkAiService(localEnv, (async () => Response.json({
    ...readyHealth,
    phone_model: 'unavailable',
  })) as typeof fetch);

  assert.equal(result.check.status, 'unavailable');
  assert.equal(result.capabilities.phoneDetection, false);
  assert.match(result.check.explanation, /YOLO phone detection/);
});

test('evidence storage readiness requires a live provider check', async () => {
  const configured: StorageInterface = {
    storageConfigured: () => true,
    verifyReadiness: async () => undefined,
    putPrivateDocument: async key => key,
    privateDocumentUrl: async key => key,
  };
  const ready = await checkEvidenceStorage(configured);
  assert.equal(ready.status, 'ready');

  const unavailable = await checkEvidenceStorage({
    ...configured,
    verifyReadiness: async () => { throw new Error('storage offline'); },
  });
  assert.equal(unavailable.status, 'unavailable');
  assert.doesNotMatch(JSON.stringify(unavailable), /storage offline/);
});

test('mandatory failed readiness checks block the server start gate', () => {
  const checks = [
    readinessCheck('ai_service', 'ready', 'AI ready', 'No action needed.'),
    readinessCheck('evidence_storage', 'unavailable', 'Storage offline', 'Restore private storage.'),
  ];
  assert.deepEqual(readinessSummary(checks), {
    ready: false,
    percentage: 50,
    mandatoryChecks: 2,
    readyChecks: 1,
  });
  assert.equal(readinessSummary(checks.filter(check => !check.mandatory)).ready, true);
});
