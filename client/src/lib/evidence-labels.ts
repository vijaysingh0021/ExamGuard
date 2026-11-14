export function radioActivityLabel(source: string | undefined, kind: string | undefined): string {
  if (source === 'bluetooth_le' && kind === 'advertisement') return 'Bluetooth signal detected';
  if (source === 'wifi' && kind === 'access_point') return 'Wi-Fi access point observed';
  if (source === 'bluetooth_le') return 'Bluetooth scanner status';
  if (source === 'wifi') return 'Wi-Fi scanner status';
  return 'Nearby radio activity';
}

export function radioSignalStrengthLabel(band: unknown): string {
  if (band === 'near') return 'Stronger signal';
  if (band === 'medium') return 'Moderate signal';
  if (band === 'far') return 'Weaker signal';
  return 'Signal strength unavailable';
}
