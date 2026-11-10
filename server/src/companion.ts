/**
 * Connection state for the Windows Companion, derived only from what it has already reported.
 * The Companion reports scanner health on events (start, stop, errors) and scan results, not on a fixed heartbeat,
 * so silence is described neutrally ("quiet"), never as a disconnection or as misconduct.
 */
export type CompanionConnection = 'not_connected' | 'connected' | 'quiet' | 'stopped_by_candidate' | 'scanner_problem';
export const QUIET_AFTER_MS = 120_000;

export function companionConnection(latest: { observedAt: Date; scannerStatus: string | null } | null, now: Date): { state: CompanionConnection; lastReportAt: Date | null; message: string } {
  if (!latest) return { state: 'not_connected', lastReportAt: null, message: 'The Companion has not reported for this attempt. If your organization requires it, pair it from the exam page.' };
  const common = { lastReportAt: latest.observedAt };
  if (latest.scannerStatus === 'stopped') return { ...common, state: 'stopped_by_candidate', message: 'Monitoring was stopped in the Companion. You can start it again from the Companion app.' };
  if (latest.scannerStatus && ['permission_denied', 'unavailable', 'error'].includes(latest.scannerStatus)) return { ...common, state: 'scanner_problem', message: 'The Companion reported a problem with Bluetooth or Wi-Fi scanning. Check that both are turned on and permitted in Windows.' };
  if (now.getTime() - latest.observedAt.getTime() > QUIET_AFTER_MS) return { ...common, state: 'quiet', message: 'No recent report from the Companion. It may be idle, minimized or offline. This is a technical status, not a finding.' };
  return { ...common, state: 'connected', message: 'The Companion is connected and monitoring is visible in its window.' };
}
