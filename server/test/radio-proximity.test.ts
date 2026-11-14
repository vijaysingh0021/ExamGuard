import assert from 'node:assert/strict';
import test from 'node:test';
import { radioProximity, supportsPotentialVisualAssistance } from '../src/radio-proximity.js';

const envKeys = ['RADIO_BLE_NEAR_DBM', 'RADIO_BLE_MEDIUM_DBM', 'RADIO_WIFI_NEAR_DBM', 'RADIO_WIFI_MEDIUM_DBM'] as const;
function withoutOverrides(run: () => void) {
  const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  try { run(); }
  finally {
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('Bluetooth and Wi-Fi RSSI use separate provisional calibration thresholds', () => {
  withoutOverrides(() => {
    assert.equal(radioProximity('bluetooth_le', -64).band, 'near');
    assert.equal(radioProximity('bluetooth_le', -66).band, 'medium');
    assert.equal(radioProximity('bluetooth_le', -81).band, 'far');
    assert.equal(radioProximity('wifi', -54).band, 'near');
    assert.equal(radioProximity('wifi', -70).band, 'medium');
    assert.equal(radioProximity('wifi', -71).band, 'far');
    assert.equal(radioProximity('wifi', -60).confidence, 'low');
  });
});

test('missing RSSI is unknown and only BLE advertisements can support the visual-assistance signal', () => {
  withoutOverrides(() => {
    assert.equal(radioProximity('bluetooth_le', null).band, 'unknown');
    assert.equal(supportsPotentialVisualAssistance('bluetooth_le', 'advertisement', 'near'), true);
    assert.equal(supportsPotentialVisualAssistance('bluetooth_le', 'advertisement', 'far'), false);
    assert.equal(supportsPotentialVisualAssistance('wifi', 'access_point', 'near'), false);
  });
});

test('venue calibration overrides thresholds and rejects invalid calibration', () => {
  withoutOverrides(() => {
    process.env.RADIO_BLE_NEAR_DBM = '-50';
    process.env.RADIO_BLE_MEDIUM_DBM = '-75';
    assert.equal(radioProximity('bluetooth_le', -54).band, 'medium');
    process.env.RADIO_BLE_NEAR_DBM = '-80';
    assert.throws(() => radioProximity('bluetooth_le', -60), /must be at least as strong/);
  });
});
