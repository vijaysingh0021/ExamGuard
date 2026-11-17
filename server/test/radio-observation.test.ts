import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '../src/generated/prisma/client.js';
import {
  radioObservationBatchInput,
  radioObservationInput,
  radioObservationSelect,
  radioRepeatSignalDedupeKey,
  withAdvertisedNameCompatibility,
} from '../src/radio-observation.js';

const missingAdvertisedNameColumn = () => new Prisma.PrismaClientKnownRequestError(
  'The column `radio_observations.advertisedName` does not exist in the current database.',
  { code: 'P2022', clientVersion: 'test', meta: { column: 'radio_observations.advertisedName' } },
);

test('radio observation projections omit optional advertised name when legacy schema is detected', () => {
  const legacy = radioObservationSelect(false);
  const current = radioObservationSelect(true);
  assert.equal('advertisedName' in legacy, false);
  assert.equal('advertisedName' in current, true);
});

test('only the missing advertised-name column triggers a compatible retry', async () => {
  const requested: boolean[] = [];
  const result = await withAdvertisedNameCompatibility(async includeAdvertisedName => {
    requested.push(includeAdvertisedName);
    if (includeAdvertisedName) throw missingAdvertisedNameColumn();
    return ['legacy-radio-observation'];
  });
  assert.deepEqual(requested, [true, false]);
  assert.deepEqual(result, { result: ['legacy-radio-observation'], advertisedNameAvailable: false });

  const unrelated = new Prisma.PrismaClientKnownRequestError(
    'A different column is missing.',
    { code: 'P2022', clientVersion: 'test', meta: { column: 'radio_observations.rssi' } },
  );
  await assert.rejects(() => withAdvertisedNameCompatibility(async () => { throw unrelated; }), unrelated);
});

test('radio ingestion validates source-kind pairs, physical RSSI and pseudonyms', () => {
  const context = {
    organizationId: '550e8400-e29b-41d4-a716-446655440011',
    examId: '550e8400-e29b-41d4-a716-446655440012',
    candidateId: '550e8400-e29b-41d4-a716-446655440013',
    attemptId: '550e8400-e29b-41d4-a716-446655440014',
  };
  const base = {
    ...context,
    source: 'bluetooth_le' as const,
    kind: 'advertisement' as const,
    observedAt: '2026-11-17T03:00:00.000Z',
    rssi: -62,
    pseudonym: 'a'.repeat(64),
    scannerStatus: 'active' as const,
  };
  assert.equal(radioObservationInput.safeParse(base).success, true);
  assert.equal(radioObservationInput.safeParse({ ...base, rssi: undefined }).success, false);
  assert.equal(radioObservationInput.safeParse({ ...base, source: 'wifi', kind: 'advertisement' }).success, false);
  assert.equal(radioObservationInput.safeParse({ ...base, source: 'bluetooth_le', kind: 'access_point' }).success, false);
  assert.equal(radioObservationInput.safeParse({ ...base, source: 'wifi', kind: 'access_point', advertisedName: 'not-an-ssid' }).success, false);
  assert.equal(radioObservationInput.safeParse({
    ...context,
    source: 'scanner_health',
    kind: 'heartbeat',
    scannerStatus: 'active',
  }).success, true);
  assert.equal(radioObservationBatchInput.safeParse({
    ...context,
    observations: [base, { ...base, source: 'wifi', kind: 'access_point' }],
  }).success, true);
});

test('repeated-observation signal keys are idempotent and pseudonym scoped', () => {
  const observationTime = new Date('2026-11-17T03:02:15.000Z');
  const common = ['org', 'attempt', 'bluetooth_le', 'advertisement'] as const;
  const first = radioRepeatSignalDedupeKey(...common, 'pseudonym-a', observationTime);
  assert.equal(first, radioRepeatSignalDedupeKey(...common, 'pseudonym-a', observationTime));
  assert.notEqual(first, radioRepeatSignalDedupeKey(...common, 'pseudonym-b', observationTime));
  assert.notEqual(first, radioRepeatSignalDedupeKey(...common, 'pseudonym-a', new Date(observationTime.getTime() + 5 * 60_000)));
});
