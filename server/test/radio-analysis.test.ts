import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeRadioObservations, type RadioAnalysisRecord } from '../src/radio-analysis.js';

const now = new Date('2026-11-17T10:00:00.000Z');
const record = (
  source: string,
  kind: string,
  secondsAgo: number,
  extras: Partial<RadioAnalysisRecord> = {},
): RadioAnalysisRecord => ({
  source,
  kind,
  observedAt: new Date(now.getTime() - secondsAgo * 1000),
  updatedAt: new Date(now.getTime() - secondsAgo * 1000),
  rssi: null,
  pseudonym: null,
  scannerStatus: 'active',
  errorCode: null,
  ...extras,
});

test('active heartbeat without radio detections is reported as operational, not detected', () => {
  const analysis = analyzeRadioObservations([
    record('scanner_health', 'heartbeat', 15),
    record('bluetooth_le', 'scanner_status', 20),
    record('wifi', 'scan_complete', 35),
  ], now);
  assert.equal(analysis.scannerOperational, true);
  assert.equal(analysis.radioObservationCount, 0);
  assert.equal(analysis.conclusion, 'scanner_operational_detection_not_confirmed');
  assert.equal(analysis.scanners.wifi.lastSuccessfulScanAt, new Date(now.getTime() - 35_000).toISOString());
});

test('stale active scanner reports are not presented as current', () => {
  const analysis = analyzeRadioObservations([
    record('bluetooth_le', 'scanner_status', 180),
    record('scanner_health', 'heartbeat', 180),
  ], now);
  assert.equal(analysis.scannerOperational, false);
  assert.equal(analysis.scanners.bluetooth.status, 'quiet');
});

test('only repeated observations of the same session pseudonym produce a repeat conclusion', () => {
  const samePseudonym = ['a', 'b', 'c'].map((suffix, index) =>
    record('bluetooth_le', 'advertisement', 20 - index * 5, {
      pseudonym: 'same-session-pseudonym',
      rssi: -60 - index,
      advertisedName: index === 0 ? 'Unverified BLE label' : null,
    }));
  const repeated = analyzeRadioObservations(samePseudonym, now);
  assert.equal(repeated.conclusion, 'repeated_observations_same_session_pseudonym');
  assert.equal(repeated.pseudonyms[0].repeatedObservationCount, 3);
  assert.equal(repeated.pseudonyms[0].rssiReadingCount, 3);
  assert.equal(repeated.pseudonyms[0].rssiRangeDb, 2);
  assert.equal(repeated.pseudonyms[0].history.length, 3);
  assert.equal(repeated.pseudonyms[0].history[0].relativeSignal.confidence, 'low');

  const differentPseudonyms = ['a', 'b', 'c'].map((pseudonym, index) =>
    record('wifi', 'access_point', 20 - index * 5, { pseudonym, rssi: -55 }));
  const singleReading = analyzeRadioObservations(differentPseudonyms, now);
  assert.equal(singleReading.conclusion, 'environmental_access_point_observation_received');
  assert.equal(singleReading.pseudonyms[0].rssiRangeDb, null);
});

test('permission failures and missing observations remain technical and inconclusive', () => {
  const failed = analyzeRadioObservations([
    record('bluetooth_le', 'scanner_status', 5, {
      scannerStatus: 'permission_denied',
      errorCode: 'consent_required',
    }),
  ], now);
  assert.equal(failed.conclusion, 'monitoring_interrupted');
  assert.equal(failed.scanners.bluetooth.permissionErrors, 1);
  assert.equal(failed.radioObservationCount, 0);
  assert.equal(failed.backendSynchronization.state, 'backend_receipt_confirmed');

  const empty = analyzeRadioObservations([], now);
  assert.equal(empty.scannerOperational, false);
  assert.equal(empty.conclusion, 'no_observations_received');
  assert.equal(empty.backendSynchronization.state, 'no_backend_receipt');
});
