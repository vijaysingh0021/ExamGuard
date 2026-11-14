import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '../src/generated/prisma/client.js';
import { radioObservationSelect, withAdvertisedNameCompatibility } from '../src/radio-observation.js';

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
