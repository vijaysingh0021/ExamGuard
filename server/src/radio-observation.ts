import { Prisma } from './generated/prisma/client.js';

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
