export type InterventionPolicy = { windowSeconds: number; warningAt: number; pauseAt: number; terminateAt: number; automaticTerminationEnabled: boolean };
export type InterventionAction = 'recorded' | 'warning' | 'paused' | 'terminated' | 'technical';
export const technicalSignals = new Set(['network_interruption', 'camera_permission_lost']);
export function interventionFor(policy: InterventionPolicy, eventType: string, eventCount: number): InterventionAction { if (technicalSignals.has(eventType)) return 'technical'; if (policy.automaticTerminationEnabled && eventCount >= policy.terminateAt) return 'terminated'; if (eventCount >= policy.pauseAt) return 'paused'; if (eventCount >= policy.warningAt) return 'warning'; return 'recorded'; }
