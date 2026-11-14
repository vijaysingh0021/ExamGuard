export type RadioSource = 'bluetooth_le' | 'wifi';
export type ProximityBand = 'near' | 'medium' | 'far' | 'unknown';

const sourceThresholds: Record<RadioSource, { nearAt: number; mediumAt: number }> = {
  bluetooth_le: { nearAt: -65, mediumAt: -80 },
  wifi: { nearAt: -55, mediumAt: -70 },
};

function calibratedThresholds(source: RadioSource) {
  const defaults = sourceThresholds[source];
  const prefix = source === 'bluetooth_le' ? 'RADIO_BLE' : 'RADIO_WIFI';
  const read = (suffix: 'NEAR_DBM' | 'MEDIUM_DBM', fallback: number) => {
    const raw = process.env[`${prefix}_${suffix}`];
    if (raw === undefined || raw.trim() === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < -127 || value > 0) {
      throw new Error(`${prefix}_${suffix} must be an integer RSSI value between -127 and 0 dBm`);
    }
    return value;
  };
  const thresholds = {
    nearAt: read('NEAR_DBM', defaults.nearAt),
    mediumAt: read('MEDIUM_DBM', defaults.mediumAt),
  };
  if (thresholds.nearAt < thresholds.mediumAt) {
    throw new Error(`${prefix}_NEAR_DBM must be at least as strong as ${prefix}_MEDIUM_DBM`);
  }
  return thresholds;
}

export function radioProximity(source: string, rssi: number | null | undefined) {
  if ((source !== 'bluetooth_le' && source !== 'wifi') || rssi === null || rssi === undefined || !Number.isInteger(rssi) || rssi < -127 || rssi > 0) {
    return { band: 'unknown' as const, confidence: 'unavailable' as const, calibration: 'source-specific-provisional-rssi-v1' };
  }
  const thresholds = calibratedThresholds(source);
  const band: ProximityBand = rssi >= thresholds.nearAt ? 'near' : rssi >= thresholds.mediumAt ? 'medium' : 'far';
  return {
    band,
    confidence: 'low' as const,
    calibration: 'source-specific-provisional-rssi-v1',
    thresholds,
    note: 'Relative signal category only. RSSI varies with hardware, orientation, obstructions, and venue; this is not a distance measurement.',
  };
}

export function supportsPotentialVisualAssistance(source: string, kind: string, band: ProximityBand): boolean {
  return source === 'bluetooth_le' && kind === 'advertisement' && (band === 'near' || band === 'medium');
}
