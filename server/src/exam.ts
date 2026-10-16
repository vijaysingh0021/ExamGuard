export const deadlineFor = (startsAt: Date, durationMinutes: number, endsAt?: Date) => { const durationDeadline = new Date(startsAt.getTime() + durationMinutes * 60_000); return endsAt && endsAt < durationDeadline ? endsAt : durationDeadline; };
export const canStartExam = (now: Date, startsAt: Date | undefined, endsAt: Date | undefined) => (!startsAt || now >= startsAt) && (!endsAt || now < endsAt);
export const isAttemptOpen = (status: string, deadlineAt: Date, now = new Date()) => status === 'in_progress' && now < deadlineAt;
