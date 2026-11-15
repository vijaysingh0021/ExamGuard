import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { mkdir, mkdtemp, readFile, rmdir, stat, writeFile } from 'node:fs/promises';
import { basename, resolve, sep } from 'node:path';

export interface StorageInterface {
  putPrivateDocument(key: string, body: Buffer, contentType: string): Promise<string>;
  privateDocumentUrl(key: string, contentType?: string, expiresInSeconds?: number): Promise<string>;
  storageConfigured(): boolean;
  verifyReadiness?(): Promise<void>;
  privateDocumentMetadata?(key: string): Promise<{ contentType?: string; contentLength?: number } | null>;
  getPrivateDocument?(key: string): Promise<Buffer | null>;
}

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OBJECT_STORAGE_BUCKET'] as const;

interface SupabaseStorageConfig {
  url: string;
  projectHost: string;
  bucket: string;
  serviceRoleKey: string;
}

interface StorageResponseDiagnostics {
  responseStatus?: number;
  requestId?: string;
}

export interface StorageConfigurationSummary {
  projectHost: string;
  bucket: string;
}

function getSupabaseStorageConfig(env: Record<string, string | undefined> = process.env): SupabaseStorageConfig {
  const missing = required.filter(key => !env[key]?.trim());
  if (missing.length) throw new Error(`Missing required private Supabase Storage configuration: ${missing.join(', ')}`);

  let url: URL;
  try {
    url = new URL(env.SUPABASE_URL!.trim());
  } catch {
    throw new Error('SUPABASE_URL must be a valid HTTPS URL.');
  }
  const localHttp = url.protocol === 'http:' &&
    env.NODE_ENV !== 'production' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !localHttp) {
    throw new Error('SUPABASE_URL must use HTTPS except for a local development endpoint.');
  }
  if (/(?:^|\.)storage\.supabase\.(?:co|in|red)$/i.test(url.hostname)) {
    throw new Error('SUPABASE_URL must be the project base URL, not a Supabase Storage S3 endpoint.');
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('SUPABASE_URL must be the project base URL without credentials, /rest/v1, Storage API paths, query parameters, or a fragment.');
  }

  return {
    url: url.origin,
    projectHost: url.host,
    bucket: env.OBJECT_STORAGE_BUCKET!.trim(),
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY!.trim(),
  };
}

function createSupabaseStorageClient(config: SupabaseStorageConfig, diagnostics: StorageResponseDiagnostics): SupabaseClient {
  const fetchWithDiagnostics: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    diagnostics.responseStatus = response.status;
    diagnostics.requestId = safeRequestId(response.headers.get('sb-request-id'), [config.serviceRoleKey]) ??
      safeRequestId(response.headers.get('x-request-id'), [config.serviceRoleKey]);
    return response;
  };
  return createClient(config.url, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: { fetch: fetchWithDiagnostics },
  });
}

export function validateStorageConfiguration(env: Record<string, string | undefined> = process.env): StorageConfigurationSummary {
  const config = getSupabaseStorageConfig(env);
  return { projectHost: config.projectHost, bucket: config.bucket };
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const failure = error as { name?: unknown; Code?: unknown; code?: unknown; status?: unknown; statusCode?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return failure.name === 'NotFound' ||
    failure.name === 'NoSuchKey' ||
    failure.Code === 'NoSuchKey' ||
    failure.code === 'NotFound' ||
    failure.code === 'NoSuchKey' ||
    failure.status === 404 ||
    failure.statusCode === 404 ||
    failure.statusCode === '404' ||
    failure.$metadata?.httpStatusCode === 404;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function safeRequestId(value: unknown, secrets: string[] = []): string | undefined {
  return typeof value === 'string' &&
    !secrets.some(secret => secret.length >= 4 && value.includes(secret)) &&
    /^[A-Za-z0-9._:-]{1,128}$/.test(value)
    ? value
    : undefined;
}

function safeErrorCode(value: unknown, secrets: string[] = []): string | undefined {
  const text = safeDiagnosticText(value, secrets);
  return typeof text === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(text) ? text : undefined;
}

function httpStatus(value: unknown): number | undefined {
  const status = typeof value === 'number' ? value :
    typeof value === 'string' && /^\d{3}$/.test(value) ? Number(value) : undefined;
  return status !== undefined && status >= 100 && status <= 599 ? status : undefined;
}

function safeDiagnosticText(value: unknown, secrets: string[] = []): string | undefined {
  if (typeof value !== 'string') return undefined;
  let text = value.slice(0, 2048);
  for (const secret of secrets) {
    if (secret.length >= 4) text = text.split(secret).join('[redacted]');
  }
  text = text
    .replace(/data:image\/[^;,\s]+;base64,[A-Za-z0-9+/=_-]+/gi, '[redacted-image-data]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted-url]')
    .replace(/\b(?:authorization|proxy-authorization|api[_ -]?key|apikey|service[_ -]?role(?:[_ -]?key)?|secret|password|token|cookie|credential)\b\s*[:=]\s*["']?[^,;\s"']+/gi, '[redacted]')
    .replace(/\bBearer\s+[^\s,;]+/gi, '[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-token]')
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}\b/gi, '[redacted-key]')
    .replace(/\b[A-Za-z0-9+/_-]{80,}={0,2}\b/g, '[redacted-data]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim();
  return text ? text.slice(0, 400) : undefined;
}

function diagnosticError(error: unknown, secrets: string[], depth = 0, seen = new Set<object>()): unknown {
  if (typeof error === 'string') return safeDiagnosticText(error, secrets);
  const failure = asRecord(error);
  if (!failure) return undefined;
  if (seen.has(failure)) return { name: 'CircularError' };
  seen.add(failure);

  const details: Record<string, unknown> = {};
  const nameText = safeDiagnosticText(failure.name, secrets);
  const name = typeof nameText === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(nameText)
    ? nameText
    : undefined;
  const message = safeDiagnosticText(failure.message, secrets);
  const code = safeErrorCode(failure.code, secrets);
  if (name) details.name = name;
  if (message) details.message = message;
  if (code) details.code = code;

  if (depth < 2) {
    const nestedCause = failure.originalError ?? failure.cause;
    const cause = diagnosticError(nestedCause, secrets, depth + 1, seen);
    if (cause !== undefined) details.cause = cause;
  }
  return Object.keys(details).length ? details : undefined;
}

function responseRequestId(error: unknown, secrets: string[]): string | undefined {
  const seen = new Set<object>();
  let current = error;
  for (let depth = 0; depth < 3; depth += 1) {
    const failure = asRecord(current);
    if (!failure || seen.has(failure)) break;
    seen.add(failure);
    const response = asRecord(failure.response) ?? failure;
    const headers = response.headers;
    const headerRecord = asRecord(headers);
    const getHeader = headers && typeof (headers as { get?: unknown }).get === 'function'
      ? (headers as { get(name: string): unknown }).get.bind(headers)
      : undefined;
    for (const headerName of ['sb-request-id', 'x-request-id']) {
      const value = getHeader?.(headerName) ??
        Object.entries(headerRecord ?? {}).find(([name]) => name.toLowerCase() === headerName)?.[1];
      const requestId = safeRequestId(value, secrets);
      if (requestId) return requestId;
    }
    current = failure.originalError ?? failure.cause;
  }
  return undefined;
}

function errorResponseStatus(error: unknown): number | undefined {
  const seen = new Set<object>();
  let current = error;
  for (let depth = 0; depth < 3; depth += 1) {
    const failure = asRecord(current);
    if (!failure || seen.has(failure)) break;
    seen.add(failure);
    const response = asRecord(failure.response);
    const status = httpStatus(failure.status) ?? httpStatus(response?.status);
    if (status) return status;
    current = failure.originalError ?? failure.cause;
  }
  return undefined;
}

function logStorageFailure(operation: string, error: unknown, config: SupabaseStorageConfig, diagnostics: StorageResponseDiagnostics) {
  if (operation !== 'get_bucket' && isNotFound(error)) return;
  const failure = asRecord(error);
  const secrets = [config.serviceRoleKey, config.url];
  const nameText = safeDiagnosticText(failure?.name, secrets);
  const name = typeof nameText === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(nameText)
    ? nameText
    : 'UnknownError';
  const statusCode = httpStatus(failure?.status) ?? httpStatus(failure?.statusCode) ??
    diagnostics.responseStatus ?? errorResponseStatus(error);
  const code = safeErrorCode(failure?.code, secrets);
  const requestId = safeRequestId(diagnostics.requestId, secrets) ?? responseRequestId(error, secrets);
  const message = safeDiagnosticText(failure?.message, secrets);
  const cause = diagnosticError(failure?.originalError ?? failure?.cause, secrets);
  console.error('storage.operation.failed', {
    operation,
    bucket: safeDiagnosticText(config.bucket, secrets),
    name,
    ...(message ? { message } : {}),
    ...(code ? { code } : {}),
    ...(statusCode ? { statusCode } : {}),
    ...(diagnostics.responseStatus ? { responseStatus: diagnostics.responseStatus } : {}),
    ...(requestId ? { requestId } : {}),
    ...(cause !== undefined ? { cause } : {}),
  });
}

async function withStorageClient<T>(operation: string, action: (client: SupabaseClient, config: SupabaseStorageConfig) => Promise<T>): Promise<T> {
  const config = getSupabaseStorageConfig();
  const diagnostics: StorageResponseDiagnostics = {};
  const client = createSupabaseStorageClient(config, diagnostics);
  try {
    return await action(client, config);
  } catch (error) {
    logStorageFailure(operation, error, config, diagnostics);
    throw error;
  }
}

function validateStorageKey(key: string): string {
  if (!key || key.startsWith('/') || key.includes('\\') || /[\u0000-\u001f\u007f]/.test(key) ||
      key.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Invalid private evidence key');
  }
  return key;
}

function signedUrlTtl(expiresInSeconds: number | undefined): number {
  const ttl = expiresInSeconds ?? 60;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 300) {
    throw new Error('Private evidence URL expiry must be between 1 and 300 seconds.');
  }
  return ttl;
}

function privateEvidenceApiBaseUrl(): string {
  let url: URL;
  try {
    url = new URL(process.env.API_BASE_URL?.trim() || 'http://localhost:4000');
  } catch {
    throw new Error('API_BASE_URL must be a valid URL for private evidence retrieval.');
  }
  const localHttp = process.env.NODE_ENV !== 'production' &&
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !localHttp) {
    throw new Error('API_BASE_URL must use HTTPS except for a local development endpoint.');
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('API_BASE_URL must be an origin without credentials, a path, query parameters, or a fragment.');
  }
  return url.origin;
}

// Local private evidence is explicitly opt-in and disabled in production.
// The path is resolved from the repository root when invoked by an npm workspace.
function localEvidenceRoot(): string | null {
  if (process.env.NODE_ENV === 'production' || !process.env.LOCAL_EVIDENCE_DIR?.trim()) return null;
  const cwd = process.cwd();
  const repositoryRoot = basename(cwd) === 'server' ? resolve(cwd, '..') : cwd;
  return resolve(repositoryRoot, process.env.LOCAL_EVIDENCE_DIR);
}

function localPathForKey(key: string): string {
  const root = localEvidenceRoot();
  if (!root) throw new Error('Local evidence storage is not enabled');
  const safeKey = validateStorageKey(key);
  const path = resolve(root, ...safeKey.split('/'));
  if (!path.startsWith(root + sep)) throw new Error('Private evidence path escaped its storage root');
  return path;
}

function evidenceJwtSecret(): string {
  const secret = process.env.JWT_SECRET ?? '';
  if (secret.length < 32) throw new Error('JWT_SECRET must be configured before private evidence URLs can be issued');
  return secret;
}

export function verifyPrivateEvidenceToken(token: string): string {
  const payload = jwt.verify(token, evidenceJwtSecret(), { audience: 'examguard-local-evidence' });
  if (typeof payload !== 'object' || typeof payload.key !== 'string') throw new Error('Invalid private evidence token');
  return payload.key;
}

async function putLocalPrivateDocument(key: string, body: Buffer, contentType: string): Promise<string> {
  const filePath = localPathForKey(key);
  await mkdir(resolve(filePath, '..'), { recursive: true });
  await writeFile(filePath, body, { flag: 'wx' });
  await writeFile(`${filePath}.meta.json`, JSON.stringify({ contentType, contentLength: body.length }), { flag: 'wx' });
  return key;
}

async function localPrivateDocumentMetadata(key: string) {
  try {
    const filePath = localPathForKey(key);
    const metadata = JSON.parse(await readFile(`${filePath}.meta.json`, 'utf8')) as { contentType?: string; contentLength?: number };
    const fileInfo = await stat(filePath);
    return { contentType: metadata.contentType, contentLength: fileInfo.size };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException;
    if (failure.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function localPrivateDocumentUrl(key: string, _contentType?: string, expiresInSeconds?: number) {
  // Check existence before issuing a short-lived URL.
  if (!(await localPrivateDocumentMetadata(key))) throw new Error('Private evidence object is missing');
  const token = jwt.sign({ key }, evidenceJwtSecret(), { audience: 'examguard-local-evidence', expiresIn: signedUrlTtl(expiresInSeconds) });
  const apiBase = (process.env.API_BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
  return `${apiBase}/api/local-evidence/${token}`;
}

async function getLocalPrivateDocument(key: string): Promise<Buffer | null> {
  try { return await readFile(localPathForKey(key)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

async function getPrivateDocument(key: string): Promise<Buffer | null> {
  if (localEvidenceRoot()) {
    const localDocument = await getLocalPrivateDocument(key);
    if (localDocument) return localDocument;
    if (!storageConfigured()) return null;
  }
  try {
    return await withStorageClient('download', async (client, config) => {
      const { data, error } = await client.storage.from(config.bucket).download(key, {}, { cache: 'no-store' });
      if (error) throw error;
      if (!data) return null;
      return Buffer.from(await data.arrayBuffer());
    });
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function putPrivateDocument(key: string, body: Buffer, contentType: string) {
  validateStorageKey(key);
  await withStorageClient('upload', async (client, config) => {
    const { error } = await client.storage.from(config.bucket).upload(key, body, {
      cacheControl: '0',
      contentType,
      upsert: true,
    });
    if (error) throw error;
  });
  return key;
}

async function verifyStorageReadiness() {
  if (localEvidenceRoot()) {
    const root = localEvidenceRoot()!;
    await mkdir(root, { recursive: true });
    const probeDirectory = await mkdtemp(resolve(root, '.readiness-'));
    await rmdir(probeDirectory);
    return;
  }
  await withStorageClient('get_bucket', async (client, config) => {
    const { data, error } = await client.storage.getBucket(config.bucket);
    if (error) throw error;
    if (data.public) throw new Error('Evidence storage bucket must be private');
  });
}

export async function privateDocumentExists(key: string) {
  validateStorageKey(key);
  if (localEvidenceRoot() && await localPrivateDocumentMetadata(key)) return true;
  // During local development, previously captured remote objects remain readable.
  // New objects go to the local store; existing remote evidence is not hidden.
  try {
    return await withStorageClient('info', async (client, config) => {
      const { data, error } = await client.storage.from(config.bucket).info(key);
      if (error) throw error;
      return Boolean(data);
    });
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

export async function privateDocumentMetadata(key: string) {
  validateStorageKey(key);
  if (localEvidenceRoot()) {
    const localMetadata = await localPrivateDocumentMetadata(key);
    if (localMetadata) return localMetadata;
    if (!storageConfigured()) return null;
  }
  try {
    return await withStorageClient('info', async (client, config) => {
      const { data, error } = await client.storage.from(config.bucket).info(key);
      if (error) throw error;
      if (!data) return null;
      const info = data as typeof data & {
        metadata?: { mimetype?: unknown; contentType?: unknown; size?: unknown; contentLength?: unknown };
        mimetype?: unknown;
        size?: unknown;
        contentType?: unknown;
        contentLength?: unknown;
      };
      const contentTypeValue = info.metadata?.mimetype ?? info.metadata?.contentType ?? info.mimetype ?? info.contentType;
      const sizeValue = info.metadata?.size ?? info.metadata?.contentLength ?? info.size ?? info.contentLength;
      const contentLength = typeof sizeValue === 'number' ? sizeValue :
        typeof sizeValue === 'string' && sizeValue.trim() !== '' ? Number(sizeValue) : undefined;
      return {
        ...(typeof contentTypeValue === 'string' ? { contentType: contentTypeValue } : {}),
        ...(contentLength !== undefined && Number.isSafeInteger(contentLength) ? { contentLength } : {}),
      };
    });
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function privateDocumentUrl(key: string, contentType?: string, expiresInSeconds = 60) {
  validateStorageKey(key);
  const ttl = signedUrlTtl(expiresInSeconds);
  const apiBase = privateEvidenceApiBaseUrl();
  if (localEvidenceRoot()) {
    if (await localPrivateDocumentMetadata(key)) return localPrivateDocumentUrl(key, contentType, ttl);
    if (!storageConfigured()) throw new Error('Private evidence object is missing from local storage');
  }
  if (!(await privateDocumentMetadata(key))) throw new Error('Private evidence object is missing');
  const token = jwt.sign({ key }, evidenceJwtSecret(), { audience: 'examguard-local-evidence', expiresIn: ttl });
  return `${apiBase}/api/private-evidence/${token}`;
}

export async function deleteStorageObject(key: string) {
  validateStorageKey(key);
  await withStorageClient('remove', async (client, config) => {
    const { error } = await client.storage.from(config.bucket).remove([key]);
    if (error) throw error;
  });
}

function storageConfigured(): boolean {
  try {
    getSupabaseStorageConfig();
    return true;
  } catch {
    return false;
  }
}

export const realStorage: StorageInterface = {
  putPrivateDocument: async (key, body, contentType) => localEvidenceRoot() ? putLocalPrivateDocument(key, body, contentType) : putPrivateDocument(key, body, contentType),
  privateDocumentUrl,
  privateDocumentMetadata,
  getPrivateDocument,
  verifyReadiness: verifyStorageReadiness,
  storageConfigured: () => Boolean(localEvidenceRoot()) || storageConfigured()
};
