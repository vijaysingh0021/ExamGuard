import crypto from 'node:crypto';
export type Signal = 'face_missing' | 'multiple_faces' | 'looking_away' | 'phone_detected' | 'visibility_hidden' | 'fullscreen_exit';
export const fingerprintFor = (organizationId: string, candidateId: string, type: string, bucket: number) => crypto.createHash('sha256').update(`${organizationId}:${candidateId}:${type}:${bucket}`).digest('hex');
export const dedupeWindow = (occurredAt: Date, cooldownSeconds: number) => Math.floor(occurredAt.getTime() / (cooldownSeconds * 1000));
export const reviewPriority = (signals: Array<{ type: string; weight: number }>) => ({ score: Math.min(100, signals.reduce((sum, x) => sum + x.weight, 0)), contributingSignals: signals });
