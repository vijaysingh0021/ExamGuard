import crypto from 'node:crypto';
import { Prisma } from './generated/prisma/client.js';
import { z } from 'zod';

const observationFields = {
  source: z.enum(['bluetooth_le', 'wifi', 'scanner_health']),
  kind: z.enum([
    'advertisement',
    'access_point',
    'heartbeat',
    'scanner_status',
    'scan_complete',
    'scan_unavailable',
    'permission_denied',
    'scan_error',
    'scan_stopped',
  ]),
  observedAt: z.string().datetime({ offset: true }).optional(),
  rssi: z.number().int().min(-127).max(0).optional(),
  pseudonym: z.string().min(16).max(128).optional(),
  advertisedName: z.string().trim().min(1).max(80)
    .refine(value => !/[\u0000-\u001f\u007f]/.test(value), 'Advertised name contains invalid control characters')
    .optional(),
  scannerStatus: z.enum(['active', 'unavailable', 'permission_denied', 'stopped', 'error']),
  errorCode: z.string().max(120).optional(),
};

function validateObservationShape(
  data: z.infer<z.ZodObject<typeof observationFields>>,
  ctx: z.RefinementCtx,
) {
  const isBleObservation = data.source === 'bluetooth_le' && data.kind === 'advertisement';
  const isWifiObservation = data.source === 'wifi' && data.kind === 'access_point';
  const isScannerStatus = data.kind === 'scanner_status' &&
    (data.source === 'bluetooth_le' || data.source === 'wifi');
  const isWifiScanComplete = data.source === 'wifi' && data.kind === 'scan_complete';
  const isHealthEvent = data.source === 'scanner_health' &&
    ['heartbeat', 'scan_unavailable', 'permission_denied', 'scan_error', 'scan_stopped'].includes(data.kind);

  if (!isBleObservation && !isWifiObservation && !isScannerStatus && !isWifiScanComplete && !isHealthEvent) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['kind'],
      message: 'Radio source and observation kind do not form a supported combination',
    });
  }

  if (isBleObservation || isWifiObservation) {
    if (!data.pseudonym) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pseudonym'], message: 'A session-scoped pseudonym is required for a radio observation' });
    if (data.rssi === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rssi'], message: 'A measured RSSI value is required for a radio observation' });
    if (data.scannerStatus !== 'active') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scannerStatus'], message: 'Radio observations require an active scanner status' });
  } else if (data.rssi !== undefined || data.pseudonym !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rssi'], message: 'Scanner status records cannot contain device RSSI or pseudonyms' });
  }

  if (data.advertisedName && data.source !== 'bluetooth_le') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['advertisedName'], message: 'Advertised names are accepted only from Bluetooth LE' });
  }
  if (isWifiScanComplete && data.scannerStatus !== 'active') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scannerStatus'], message: 'A completed scan requires an active scanner status' });
  }
  if (data.kind === 'heartbeat' && data.scannerStatus !== 'active') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scannerStatus'], message: 'A heartbeat requires an active Companion status' });
  }
}

const radioObservationRecordSchema = z.object(observationFields).superRefine(validateObservationShape);
const radioObservationContext = {
  organizationId: z.string().uuid(),
  examId: z.string().uuid(),
  candidateId: z.string().uuid(),
  attemptId: z.string().uuid(),
};

export const radioObservationInput = z.object({
  ...radioObservationContext,
  ...observationFields,
}).superRefine(validateObservationShape);

export const radioObservationBatchInput = z.object({
  ...radioObservationContext,
  observations: z.array(radioObservationRecordSchema).min(1).max(100),
});

export function radioRepeatSignalDedupeKey(
  organizationId: string,
  attemptId: string,
  source: string,
  kind: string,
  pseudonym: string,
  observedAt: Date,
) {
  const fiveMinuteWindow = Math.floor(observedAt.getTime() / (5 * 60_000));
  return crypto.createHash('sha256')
    .update(`${organizationId}:${attemptId}:${source}:${kind}:${pseudonym}:${fiveMinuteWindow}`)
    .digest('hex');
}

export function radioObservationSelect(includeAdvertisedName: boolean) {
  return {
    id: true,
    organizationId: true,
    examId: true,
    candidateId: true,
    attemptId: true,
    source: true,
    kind: true,
    observedAt: true,
    rssi: true,
    pseudonym: true,
    ...(includeAdvertisedName ? { advertisedName: true } : {}),
    scannerStatus: true,
    errorCode: true,
    fingerprint: true,
    limitations: true,
    expiresAt: true,
    createdAt: true,
    updatedAt: true,
  } satisfies Prisma.RadioObservationSelect;
}

function isMissingAdvertisedNameColumn(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2022') return false;
  const column = error.meta?.column;
  return (typeof column === 'string' && column.includes('advertisedName')) ||
    error.message.includes('advertisedName');
}

export async function withAdvertisedNameCompatibility<T>(
  query: (includeAdvertisedName: boolean) => Promise<T>,
): Promise<{ result: T; advertisedNameAvailable: boolean }> {
  try {
    return { result: await query(true), advertisedNameAvailable: true };
  } catch (error) {
    if (!isMissingAdvertisedNameColumn(error)) throw error;
    return { result: await query(false), advertisedNameAvailable: false };
  }
}
