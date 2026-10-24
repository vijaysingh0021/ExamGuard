import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
const required = ['OBJECT_STORAGE_ENDPOINT', 'OBJECT_STORAGE_BUCKET', 'OBJECT_STORAGE_ACCESS_KEY_ID', 'OBJECT_STORAGE_SECRET_ACCESS_KEY'] as const;
export const storageConfigured = () => required.every(key => Boolean(process.env[key]));
export async function putPrivateDocument(key: string, body: Buffer, contentType: string) { if (!storageConfigured()) throw new Error('Private object storage is not configured'); const client = new S3Client({ endpoint: process.env.OBJECT_STORAGE_ENDPOINT, region: process.env.OBJECT_STORAGE_REGION || 'auto', credentials: { accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID!, secretAccessKey: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY! } }); await client.send(new PutObjectCommand({ Bucket: process.env.OBJECT_STORAGE_BUCKET!, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: 'AES256' })); return key; }
export async function privateDocumentUrl(key: string) {
  if (!storageConfigured()) throw new Error('Private object storage is not configured');
  const client = new S3Client({ endpoint: process.env.OBJECT_STORAGE_ENDPOINT, region: process.env.OBJECT_STORAGE_REGION || 'auto', credentials: { accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID!, secretAccessKey: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY! } });
  return getSignedUrl(client, new GetObjectCommand({ Bucket: process.env.OBJECT_STORAGE_BUCKET!, Key: key }), { expiresIn: 60 });
}
