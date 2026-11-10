/** Pure scheduling/lifecycle rules shared by background workflows and tests. */
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

/** The single reminder window that applies now. Only the nearest window fires so a late-published exam never sends two. */
export const reminderWindow = (startsAt: Date, now: Date): '1h' | '24h' | null => {
  const until = startsAt.getTime() - now.getTime();
  if (until <= 0) return null;
  if (until <= HOUR) return '1h';
  if (until <= DAY) return '24h';
  return null;
};

/** Same format as the candidate submit route so receipts look identical however an attempt was closed. */
export const receiptCodeFor = (attemptId: string, at: Date) => `EG-${attemptId.slice(-6).toUpperCase()}-${at.getTime().toString(36).toUpperCase()}`;

/** Deterministic job key per time bucket: every API instance enqueues the same key, so only one job exists. */
export const bucketKey = (type: string, now: Date, bucketMs: number) => `${type}:${Math.floor(now.getTime() / bucketMs)}`;

export const retentionCutoff = (now: Date, days: number) => new Date(now.getTime() - days * DAY);
export const parseRetentionDays = (raw: string | undefined) => { const n = Number(raw); return Number.isInteger(n) && n >= 1 && n <= 3650 ? n : undefined; };

export const isoDay = (now: Date) => now.toISOString().slice(0, 10);

/** What an exam's status should become purely from time. Returns undefined when no automatic change applies. */
export const timeDrivenExamStatus = (exam: { status: string; startsAt?: Date | null; endsAt?: Date | null }, now: Date, hasOpenAttempts: boolean): 'live' | 'completed' | undefined => {
  if (exam.endsAt && exam.endsAt <= now && ['published', 'scheduled', 'live'].includes(exam.status) && !hasOpenAttempts) return 'completed';
  if (exam.status === 'scheduled' && exam.startsAt && exam.startsAt <= now && !(exam.endsAt && exam.endsAt <= now)) return 'live';
  return undefined;
};
