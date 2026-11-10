import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import jwt from 'jsonwebtoken';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, resolve, sep } from 'node:path';

export interface StorageInterface {
  putPrivateDocument(key: string, body: Buffer, contentType: string): Promise<string>;
  privateDocumentUrl(key: string, contentType?: string, expiresInSeconds?: number): Promise<string>;
  storageConfigured(): boolean;
  privateDocumentMetadata?(key: string): Promise<{ contentType?: string; contentLength?: number } | null>;
  getPrivateDocument?(key: string): Promise<Buffer | null>;
}

const required = ['OBJECT_STORAGE_ENDPOINT', 'OBJECT_STORAGE_BUCKET', 'OBJECT_STORAGE_ACCESS_KEY_ID', 'OBJECT_STORAGE_SECRET_ACCESS_KEY'] as const;
const s3Configured = () => required.every(key => Boolean(process.env[key]));

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
  if (!key || key.startsWith('/') || key.includes('\\') || key.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Invalid private evidence key');
  }
  const path = resolve(root, ...key.split('/'));
  if (!path.startsWith(root + sep)) throw new Error('Private evidence path escaped its storage root');
  return path;
}

function evidenceJwtSecret(): string {
  const secret = process.env.JWT_SECRET ?? '';
  if (secret.length < 32) throw new Error('JWT_SECRET must be configured before local evidence URLs can be issued');
  return secret;
}

export function verifyLocalEvidenceToken(token: string): string {
  const payload = jwt.verify(token, evidenceJwtSecret(), { audience: 'examguard-local-evidence' });
  if (typeof payload !== 'object' || typeof payload.key !== 'string') throw new Error('Invalid local evidence token');
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

async function localPrivateDocumentUrl(key: string, _contentType?: string, expiresInSeconds = 60) {
  // Check existence before issuing a URL. The token is short-lived like an S3 presigned URL.
  if (!(await localPrivateDocumentMetadata(key))) throw new Error('Private evidence object is missing');
  const token = jwt.sign({ key }, evidenceJwtSecret(), { audience: 'examguard-local-evidence', expiresIn: expiresInSeconds });
  const apiBase = (process.env.API_BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
  return `${apiBase}/api/local-evidence/${token}`;
}

async function getLocalPrivateDocument(key: string): Promise<Buffer | null> {
  try { return await readFile(localPathForKey(key)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

export async function putPrivateDocument(key: string, body: Buffer, contentType: string) {
  if (!s3Configured()) throw new Error('Private object storage is not configured');
  const client = new S3Client({ endpoint: process.env.OBJECT_STORAGE_ENDPOINT, region: process.env.OBJECT_STORAGE_REGION || 'auto', credentials: { accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID!, secretAccessKey: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY! } });
  await client.send(new PutObjectCommand({ Bucket: process.env.OBJECT_STORAGE_BUCKET!, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: 'AES256' }));
  return key;
}

export async function privateDocumentExists(key: string) {
  if (localEvidenceRoot() && await localPrivateDocumentMetadata(key)) return true;
  // During local development, previously captured S3 objects remain readable.
  // New objects go to the local store; existing remote evidence is not hidden.
  if (!s3Configured()) return false;
  const client = new S3Client({ endpoint: process.env.OBJECT_STORAGE_ENDPOINT, region: process.env.OBJECT_STORAGE_REGION || 'auto', credentials: { accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID!, secretAccessKey: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY! } });
  try { await client.send(new HeadObjectCommand({ Bucket: process.env.OBJECT_STORAGE_BUCKET!, Key: key })); return true; } catch { return false; }
}

export async function privateDocumentMetadata(key: string) {
  if (localEvidenceRoot()) {
    const localMetadata = await localPrivateDocumentMetadata(key);
    if (localMetadata) return localMetadata;
    if (!s3Configured()) return null;
  }
  if (!s3Configured()) throw new Error('Private object storage is not configured');
  const client = new S3Client({ endpoint: process.env.OBJECT_STORAGE_ENDPOINT, region: process.env.OBJECT_STORAGE_REGION || 'auto', credentials: { accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID!, secretAccessKey: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY! } });
  try {
    const result = await client.send(new HeadObjectCommand({ Bucket: process.env.OBJECT_STORAGE_BUCKET!, Key: key }));
    return { contentType: result.ContentType, contentLength: result.ContentLength };
  } catch (error) {
    const failure = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (failure.name === 'NotFound' || failure.name === 'NoSuchKey' || failure.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

export async function privateDocumentUrl(key: string, contentType?: string, expiresInSeconds = 60) {
  if (localEvidenceRoot()) {
    if (await localPrivateDocumentMetadata(key)) return localPrivateDocumentUrl(key, contentType, expiresInSeconds);
    if (!s3Configured()) throw new Error('Private evidence object is missing from local storage');
  }
  if (!s3Configured()) throw new Error('Private object storage is not configured');
  const client = new S3Client({ endpoint: process.env.OBJECT_STORAGE_ENDPOINT, region: process.env.OBJECT_STORAGE_REGION || 'auto', credentials: { accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID!, secretAccessKey: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY! } });
  return getSignedUrl(client, new GetObjectCommand({ Bucket: process.env.OBJECT_STORAGE_BUCKET!, Key: key, ...(contentType ? { ResponseContentType: contentType } : {}), ResponseCacheControl: 'private, no-store', ResponseContentDisposition: 'inline' }), { expiresIn: expiresInSeconds });
}

export const realStorage: StorageInterface = {
  putPrivateDocument: async (key, body, contentType) => localEvidenceRoot() ? putLocalPrivateDocument(key, body, contentType) : putPrivateDocument(key, body, contentType),
  privateDocumentUrl,
  privateDocumentMetadata,
  getPrivateDocument: async key => localEvidenceRoot() ? getLocalPrivateDocument(key) : null,
  storageConfigured: () => Boolean(localEvidenceRoot()) || s3Configured()
};
