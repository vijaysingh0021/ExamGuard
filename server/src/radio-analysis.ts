import { radioProximity } from './radio-proximity.js';

export type RadioAnalysisRecord = {
  source: string;
  kind: string;
  observedAt: Date;
  updatedAt: Date;
  rssi: number | null;
  pseudonym: string | null;
  advertisedName?: string | null;
  scannerStatus: string;
  errorCode: string | null;
};

const isRadioObservation = (record: RadioAnalysisRecord) =>
  (record.source === 'bluetooth_le' && record.kind === 'advertisement') ||
  (record.source === 'wifi' && record.kind === 'access_point');

function latest(records: RadioAnalysisRecord[]) {
  return [...records].sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())[0] ?? null;
}

export function analyzeRadioObservations(records: RadioAnalysisRecord[], now = new Date()) {
  const ble = records.filter(record => record.source === 'bluetooth_le');
  const wifi = records.filter(record => record.source === 'wifi');
  const radioObservations = records.filter(isRadioObservation);
  const heartbeat = latest(records.filter(record => record.source === 'scanner_health' && record.kind === 'heartbeat'));
  const heartbeatActive = Boolean(
    heartbeat &&
    heartbeat.scannerStatus === 'active' &&
    now.getTime() - heartbeat.observedAt.getTime() <= 90_000,
  );

  const scanner = (sourceRecords: RadioAnalysisRecord[]) => {
    const state = latest(sourceRecords.filter(record => record.kind === 'scanner_status'));
    const scan = latest(sourceRecords.filter(record => record.kind === 'scan_complete'));
    const lastError = latest(sourceRecords.filter(record =>
      record.kind === 'scanner_status' &&
      ['error', 'unavailable', 'permission_denied'].includes(record.scannerStatus),
    ));
    const observations = sourceRecords.filter(isRadioObservation);
    const stateIsStale = Boolean(state && now.getTime() - state.observedAt.getTime() > 90_000);
    return {
      status: !state ? 'unknown' : state.scannerStatus === 'active' && stateIsStale ? 'quiet' : state.scannerStatus,
      statusAt: state?.observedAt.toISOString() ?? null,
      lastSuccessfulScanAt: scan?.observedAt.toISOString() ?? null,
      lastReceivedObservationAt: latest(observations)?.observedAt.toISOString() ?? null,
      scanFailures: sourceRecords.filter(record =>
        record.kind === 'scanner_status' &&
        ['error', 'unavailable', 'permission_denied'].includes(record.scannerStatus),
      ).length,
      permissionErrors: sourceRecords.filter(record => record.scannerStatus === 'permission_denied').length,
      unavailableReports: sourceRecords.filter(record => record.scannerStatus === 'unavailable').length,
      lastErrorCode: lastError?.errorCode ?? null,
      lastErrorAt: lastError?.observedAt.toISOString() ?? null,
    };
  };

  const grouped = new Map<string, RadioAnalysisRecord[]>();
  for (const observation of radioObservations) {
    if (!observation.pseudonym) continue;
    const key = `${observation.source}:${observation.pseudonym}`;
    const group = grouped.get(key) ?? [];
    group.push(observation);
    grouped.set(key, group);
  }
  const pseudonyms = [...grouped.entries()].map(([key, observations]) => {
    const [source] = key.split(':', 1);
    const ordered = [...observations].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
    const rssiReadings = observations.flatMap(observation =>
      observation.rssi === null ? [] : [observation.rssi],
    );
    return {
      source,
      pseudonym: observations[0].pseudonym,
      repeatedObservationCount: observations.length,
      rssiReadingCount: rssiReadings.length,
      rssiRangeDb: rssiReadings.length < 2
        ? null
        : Math.max(...rssiReadings) - Math.min(...rssiReadings),
      history: ordered.map(observation => ({
        observedAt: observation.observedAt.toISOString(),
        rssi: observation.rssi,
        relativeSignal: radioProximity(source, observation.rssi),
        advertisedName: observation.advertisedName ?? null,
      })),
    };
  }).sort((a, b) => b.repeatedObservationCount - a.repeatedObservationCount);

  const latestSensorError = latest(records.filter(record =>
    record.kind === 'scanner_status' &&
    ['error', 'unavailable', 'permission_denied', 'stopped'].includes(record.scannerStatus),
  ));
  const repeated = pseudonyms.some(group => group.repeatedObservationCount >= 3);
  const hasBleObservations = radioObservations.some(record => record.source === 'bluetooth_le');
  const hasWifiObservations = radioObservations.some(record => record.source === 'wifi');
  const conclusion = repeated
    ? 'repeated_observations_same_session_pseudonym'
    : hasBleObservations && hasWifiObservations
      ? 'radio_observations_received'
      : hasBleObservations
        ? 'ble_advertisement_received'
        : hasWifiObservations
          ? 'environmental_access_point_observation_received'
      : heartbeatActive
        ? 'scanner_operational_detection_not_confirmed'
        : latestSensorError
          ? 'monitoring_interrupted'
          : 'no_observations_received';

  return {
    scannerOperational: heartbeatActive,
    companionHeartbeatAt: heartbeat?.observedAt.toISOString() ?? null,
    scanners: {
      bluetooth: scanner(ble),
      wifi: scanner(wifi),
    },
    backendSynchronization: {
      state: records.length ? 'backend_receipt_confirmed' : 'no_backend_receipt',
      lastAcknowledgedAt: latest(records.map(record => ({ ...record, observedAt: record.updatedAt })))?.updatedAt.toISOString() ?? null,
      acceptedRecordCount: records.length,
    },
    radioObservationCount: radioObservations.length,
    missingRssiCount: radioObservations.filter(record => record.rssi === null).length,
    pseudonyms,
    conclusion,
    confidence: radioObservations.length ? 'low' : 'unavailable',
    limitations: [
      'A scanner heartbeat or active status is not proof that any device was detected.',
      'BLE pseudonyms are session-scoped and do not establish device ownership or identity.',
      'Wi-Fi observations describe access points, not connected client devices or student phones.',
      'RSSI categories are relative, provisional signal comparisons and are not distance measurements.',
      'This server-side view confirms received records; it cannot report observations still queued locally.',
      'Radio observations cannot automatically establish misconduct or justify a penalty.',
    ],
  };
}
