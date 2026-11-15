import '../src/config.js';
import { randomUUID } from 'node:crypto';
import {
  deleteStorageObject,
  privateDocumentExists,
  realStorage,
  validateStorageConfiguration,
  verifyPrivateEvidenceToken,
} from '../src/storage.js';

process.env.NODE_ENV = 'production';

const objectKey = `smoke-tests/${randomUUID()}.txt`;
const expectedBody = Buffer.from('ExamGuard Supabase storage verification');

function safeFailure(error: unknown) {
  const failure = error && typeof error === 'object'
    ? error as {
      name?: unknown;
      code?: unknown;
      Code?: unknown;
      $metadata?: { httpStatusCode?: unknown; requestId?: unknown; attempts?: unknown };
      $response?: { headers?: Record<string, unknown> };
      message?: unknown;
    }
    : {};
  const codeValue = failure.code ?? failure.Code;
  const safeMessage = typeof failure.message === 'string' &&
    /^(Missing required private Supabase Storage configuration: [A-Z0-9_, ]+|SUPABASE_[A-Z_]+ .{1,160}|OBJECT_STORAGE_[A-Z_]+ .{1,120})$/.test(failure.message)
    ? failure.message
    : undefined;
  const requestId = typeof failure.$metadata?.requestId === 'string' &&
    /^[A-Za-z0-9-]{1,128}$/.test(failure.$metadata.requestId)
    ? failure.$metadata.requestId
    : undefined;
  const attempts = typeof failure.$metadata?.attempts === 'number' && Number.isInteger(failure.$metadata.attempts)
    ? failure.$metadata.attempts
    : undefined;
  const contentTypeValue = failure.$response?.headers?.['content-type'];
  const contentType = typeof contentTypeValue === 'string' &&
    /^[A-Za-z0-9.+/-]+(?:;[A-Za-z0-9=.+-]+)?$/.test(contentTypeValue)
    ? contentTypeValue
    : undefined;
  return {
    name: typeof failure.name === 'string' ? failure.name.slice(0, 80) : 'UnknownError',
    ...(typeof codeValue === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(codeValue) ? { code: codeValue } : {}),
    ...(typeof failure.$metadata?.httpStatusCode === 'number' ? { statusCode: failure.$metadata.httpStatusCode } : {}),
    ...(requestId ? { requestId } : {}),
    ...(attempts ? { attempts } : {}),
    ...(contentType ? { contentType } : {}),
    ...(safeMessage ? { message: safeMessage } : {}),
  };
}

async function main() {
  let failed = false;
  try {
    const config = validateStorageConfiguration();
    console.log('1. Environment configuration: PASS', {
      projectHost: config.projectHost,
      bucket: config.bucket,
    });

    await realStorage.verifyReadiness?.();
    console.log('2. Bucket connectivity: PASS');

    await realStorage.putPrivateDocument(objectKey, expectedBody, 'text/plain');
    console.log('3. Private object upload: PASS');

    const metadata = await realStorage.privateDocumentMetadata?.(objectKey);
    if (!metadata || metadata.contentType !== 'text/plain' || metadata.contentLength !== expectedBody.length) {
      throw new Error('Uploaded object metadata did not match the test object.');
    }
    console.log('4. Object metadata: PASS');

    if (!await privateDocumentExists(objectKey)) {
      throw new Error('The uploaded object was not found by its unique test key.');
    }
    console.log('5. Object existence: PASS');

    const encodedKey = objectKey.split('/').map(encodeURIComponent).join('/');
    const publicUrl = `https://${config.projectHost}/storage/v1/object/public/${encodeURIComponent(config.bucket)}/${encodedKey}`;
    const publicResponse = await fetch(publicUrl, { signal: AbortSignal.timeout(15_000) });
    if (publicResponse.ok) throw new Error('The smoke-test object is accessible through the unauthenticated public-object endpoint.');
    if (![400, 401, 403, 404].includes(publicResponse.status)) {
      throw new Error(`The public-object privacy check returned HTTP ${publicResponse.status}.`);
    }
    console.log('6. Bucket privacy: PASS (unauthenticated public access denied)');

    const privateUrl = await realStorage.privateDocumentUrl(objectKey, 'text/plain', 60);
    const token = privateUrl.split('/').at(-1);
    if (!token || verifyPrivateEvidenceToken(token) !== objectKey) {
      throw new Error('The private API URL did not contain a valid token for the test object.');
    }
    console.log('7. Short-lived private API URL generation: PASS (URL omitted)');

    const downloadedBody = await realStorage.getPrivateDocument?.(objectKey);
    if (!downloadedBody) throw new Error('The uploaded private object could not be downloaded through Supabase Storage.');
    console.log('8. Supabase Storage SDK download: PASS');
    if (!downloadedBody.equals(expectedBody)) {
      throw new Error('Downloaded content did not match the uploaded test object.');
    }
    console.log('9. Downloaded content integrity: PASS');
  } catch (error) {
    failed = true;
    console.error('Storage smoke verification: FAILED', safeFailure(error));
  } finally {
    try {
      await deleteStorageObject(objectKey);
      console.log('9. Test object cleanup: PASS');
    } catch (error) {
      failed = true;
      console.error('Test object cleanup: FAILED', { key: objectKey, ...safeFailure(error) });
    }
  }
  if (failed) process.exitCode = 1;
}

void main();
