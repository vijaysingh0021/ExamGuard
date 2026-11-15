import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import {
  privateDocumentExists,
  privateDocumentMetadata,
  privateDocumentUrl,
  putPrivateDocument,
  realStorage,
  validateStorageConfiguration,
  verifyPrivateEvidenceToken,
} from '../src/storage.js';

const validEnvironment = {
  NODE_ENV: 'production',
  SUPABASE_URL: 'https://projectref.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  OBJECT_STORAGE_BUCKET: 'examguard-evidence',
};

test('Supabase configuration validates the project URL and excludes credentials from diagnostics', () => {
  const summary = validateStorageConfiguration(validEnvironment);
  assert.deepEqual(summary, { projectHost: 'projectref.supabase.co', bucket: 'examguard-evidence' });
  assert.doesNotMatch(JSON.stringify(summary), /test-service-role-key/);
  for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OBJECT_STORAGE_BUCKET']) {
    assert.throws(() => validateStorageConfiguration({ ...validEnvironment, [key]: ' ' }), new RegExp(key));
  }
  assert.throws(() => validateStorageConfiguration({ ...validEnvironment, SUPABASE_URL: 'http://storage.example.test' }), /must use HTTPS/);
  assert.throws(() => validateStorageConfiguration({ ...validEnvironment, SUPABASE_URL: 'https://projectref.supabase.co/rest/v1' }), /project base URL/);
  assert.throws(() => validateStorageConfiguration({ ...validEnvironment, SUPABASE_URL: 'https://projectref.supabase.co/storage/v1/s3' }), /project base URL/);
  assert.throws(() => validateStorageConfiguration({ ...validEnvironment, SUPABASE_URL: 'https://projectref.storage.supabase.co' }), /S3 endpoint/);
});

test('Supabase SDK uploads, reads metadata and streams private evidence without exposing the service key', async () => {
  const objectBytes = Buffer.from('test image bytes');
  const requests: Array<{ method: string; path: string; apiKey: string; authorization: string; contentType: string; cacheControl: string }> = [];
  let denyInfo = false;
  let missingInfo = false;
  let publicBucket = false;
  let bucketFailure: 'none' | 'invalid-credentials' | 'missing-bucket' | 'network' = 'none';
  let uploadedBody: Buffer | undefined;
  const server = createServer((request, response) => {
    const bodyChunks: Buffer[] = [];
    request.on('data', chunk => bodyChunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      const path = request.url ?? '';
      requests.push({
        method: request.method ?? '',
        path,
        apiKey: String(request.headers.apikey ?? ''),
        authorization: String(request.headers.authorization ?? ''),
        contentType: String(request.headers['content-type'] ?? ''),
        cacheControl: String(request.headers['cache-control'] ?? ''),
      });

      if (path === '/storage/v1/bucket/examguard-evidence') {
        if (bucketFailure === 'network') {
          request.socket.destroy();
          return;
        }
        response.setHeader('Content-Type', 'application/json');
        if (bucketFailure === 'invalid-credentials') {
          response.statusCode = 401;
          response.setHeader('sb-request-id', 'request-auth-401');
          response.end(JSON.stringify({
            statusCode: '401',
            code: 'InvalidJWT',
            message: `Invalid API key local-test-service-role-key; Authorization: Bearer local-test-service-role-key; https://projectref.supabase.co/storage/v1/object/sign/x?token=signed-token; data:image/jpeg;base64,${'A'.repeat(120)}`,
          }));
          return;
        }
        if (bucketFailure === 'missing-bucket') {
          response.statusCode = 404;
          response.setHeader('x-request-id', 'request-bucket-404');
          response.end(JSON.stringify({
            statusCode: '404',
            code: 'NoSuchBucket',
            message: 'Bucket not found',
          }));
          return;
        }
        response.end(JSON.stringify({ id: 'examguard-evidence', name: 'examguard-evidence', public: publicBucket }));
        return;
      }
      if (path.startsWith('/storage/v1/object/info/')) {
        response.setHeader('Content-Type', 'application/json');
        if (denyInfo) {
          response.statusCode = 403;
          response.end(JSON.stringify({ statusCode: '403', error: 'AccessDenied', message: 'Access denied' }));
        } else if (missingInfo) {
          response.statusCode = 404;
          response.end(JSON.stringify({ statusCode: '404', error: 'NotFound', message: 'Not found' }));
        } else {
          response.end(JSON.stringify({
            id: 'object-id',
            name: 'frame.jpg',
            bucket_id: 'examguard-evidence',
            size: objectBytes.length,
            content_type: 'image/jpeg',
          }));
        }
        return;
      }
      if (request.method === 'POST' && path.startsWith('/storage/v1/object/examguard-evidence/')) {
        uploadedBody = Buffer.concat(bodyChunks);
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ Key: path }));
        return;
      }
      if (request.method === 'GET' && path.startsWith('/storage/v1/object/examguard-evidence/')) {
        response.setHeader('Content-Type', 'image/jpeg');
        response.end(objectBytes);
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ statusCode: '404', error: 'NotFound', message: 'Not found' }));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  const environment: Record<string, string | undefined> = {
    NODE_ENV: 'development',
    LOCAL_EVIDENCE_DIR: undefined,
    SUPABASE_URL: `http://127.0.0.1:${address.port}`,
    SUPABASE_SERVICE_ROLE_KEY: 'local-test-service-role-key',
    OBJECT_STORAGE_BUCKET: 'examguard-evidence',
    JWT_SECRET: 'test-secret-that-is-long-enough-for-evidence-tokens',
    API_BASE_URL: 'http://localhost:4000',
  };
  const previousEnvironment = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(environment)) {
    previousEnvironment.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const originalConsoleError = console.error;
  const storageLogs: unknown[][] = [];
  console.error = (...args: unknown[]) => { storageLogs.push(args); };

  try {
    const key = 'organizations/org/attempts/attempt/evidence/frame.jpg';
    await realStorage.verifyReadiness?.();
    const bucketCheck = requests.find(request => request.method === 'GET' && request.path === '/storage/v1/bucket/examguard-evidence');
    assert.ok(bucketCheck);
    assert.equal(bucketCheck.authorization, 'Bearer local-test-service-role-key');
    await putPrivateDocument(key, objectBytes, 'image/jpeg');
    assert.deepEqual(uploadedBody, objectBytes);
    assert.deepEqual(await privateDocumentMetadata(key), { contentType: 'image/jpeg', contentLength: objectBytes.length });
    assert.equal(await privateDocumentExists(key), true);
    assert.deepEqual(await realStorage.getPrivateDocument?.(key), objectBytes);

    missingInfo = true;
    assert.equal(await privateDocumentExists(key), false);
    assert.equal(await privateDocumentMetadata(key), null);
    missingInfo = false;

    const url = await privateDocumentUrl(key, 'image/jpeg', 60);
    const token = url.split('/').at(-1)!;
    assert.equal(url.startsWith('http://localhost:4000/api/private-evidence/'), true);
    assert.equal(verifyPrivateEvidenceToken(token), key);
    assert.doesNotMatch(url, /local-test-service-role-key/);
    process.env.NODE_ENV = 'production';
    process.env.API_BASE_URL = 'http://api.example.test';
    await assert.rejects(privateDocumentUrl(key), /API_BASE_URL must use HTTPS/);
    process.env.NODE_ENV = 'development';
    process.env.API_BASE_URL = 'http://localhost:4000';
    assert.ok(requests.every(request =>
      request.apiKey === 'local-test-service-role-key' &&
      request.authorization === 'Bearer local-test-service-role-key',
    ));
    const upload = requests.find(request => request.method === 'POST' && request.path.startsWith('/storage/v1/object/examguard-evidence/'));
    assert.ok(upload);
    assert.equal(upload.contentType, 'image/jpeg');
    assert.equal(upload.cacheControl, 'max-age=0');

    publicBucket = true;
    const verifyStorage = realStorage.verifyReadiness;
    assert.ok(verifyStorage);
    await assert.rejects(verifyStorage(), /bucket must be private/);
    publicBucket = false;

    bucketFailure = 'invalid-credentials';
    await assert.rejects(verifyStorage());
    const invalidCredentialsLog = storageLogs
      .filter(entry => entry[0] === 'storage.operation.failed')
      .map(entry => entry[1] as Record<string, unknown>)
      .find(entry => entry.operation === 'get_bucket' && entry.responseStatus === 401);
    assert.ok(invalidCredentialsLog);
    assert.equal(invalidCredentialsLog.bucket, 'examguard-evidence');
    assert.equal(invalidCredentialsLog.name, 'StorageApiError');
    assert.equal(invalidCredentialsLog.statusCode, 401);
    assert.equal(invalidCredentialsLog.requestId, 'request-auth-401');
    assert.match(String(invalidCredentialsLog.message), /Invalid API key/);
    assert.doesNotMatch(JSON.stringify(invalidCredentialsLog), /local-test-service-role-key|https:\/\/|signed-token|A{80}/);

    bucketFailure = 'missing-bucket';
    await assert.rejects(verifyStorage());
    const missingBucketLog = storageLogs
      .filter(entry => entry[0] === 'storage.operation.failed')
      .map(entry => entry[1] as Record<string, unknown>)
      .find(entry => entry.operation === 'get_bucket' && entry.responseStatus === 404);
    assert.ok(missingBucketLog);
    assert.equal(missingBucketLog.code, 'NoSuchBucket');
    assert.equal(missingBucketLog.requestId, 'request-bucket-404');

    bucketFailure = 'network';
    await assert.rejects(verifyStorage());
    const networkLog = storageLogs
      .filter(entry => entry[0] === 'storage.operation.failed')
      .map(entry => entry[1] as Record<string, unknown>)
      .find(entry => entry.operation === 'get_bucket' && entry.name === 'StorageUnknownError');
    assert.ok(networkLog);
    assert.equal(networkLog.message, 'fetch failed');
    assert.equal(networkLog.responseStatus, undefined);
    assert.ok(networkLog.cause && typeof networkLog.cause === 'object');
    assert.ok((networkLog.cause as Record<string, unknown>).name);
    assert.ok((networkLog.cause as Record<string, unknown>).message);

    bucketFailure = 'none';
    denyInfo = true;
    await assert.rejects(privateDocumentExists(key), error =>
      Boolean(error && typeof error === 'object' && 'statusCode' in error && error.statusCode === '403'),
    );
    assert.doesNotMatch(JSON.stringify(storageLogs), /local-test-service-role-key/);
  } finally {
    console.error = originalConsoleError;
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
});
