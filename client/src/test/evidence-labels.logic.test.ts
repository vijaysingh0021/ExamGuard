import { describe, expect, it } from 'vitest';
import { radioActivityLabel, radioSignalStrengthLabel } from '../lib/evidence-labels';

describe('plain-language radio evidence labels', () => {
  it('distinguishes Bluetooth and Wi-Fi observations from scanner status', () => {
    expect(radioActivityLabel('bluetooth_le', 'advertisement')).toBe('Bluetooth signal detected');
    expect(radioActivityLabel('wifi', 'access_point')).toBe('Wi-Fi access point observed');
    expect(radioActivityLabel('bluetooth_le', 'permission_denied')).toBe('Bluetooth scanner status');
  });

  it('explains relative signal strength without presenting it as measured distance', () => {
    expect(radioSignalStrengthLabel('near')).toBe('Stronger signal');
    expect(radioSignalStrengthLabel('medium')).toBe('Moderate signal');
    expect(radioSignalStrengthLabel('far')).toBe('Weaker signal');
    expect(radioSignalStrengthLabel('unknown')).toBe('Signal strength unavailable');
  });
});
