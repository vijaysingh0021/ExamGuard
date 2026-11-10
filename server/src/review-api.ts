/** Pure parsing and projection helpers for the submissions, attempt-review and audit-log endpoints (no dependencies). */
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ATTEMPT_STATUSES = ['in_progress', 'paused', 'submitted', 'expired', 'terminated'] as const;

const int = (raw: unknown, name: string, min: number, max: number, fallback: number): Parsed<number> => {
  if (raw === undefined || raw === '') return { ok: true, value: fallback };
  const n = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(n) && n >= min && n <= max ? { ok: true, value: n } : { ok: false, error: `${name} must be an integer from ${min} to ${max}` };
};
const text = (raw: unknown, name: string, max: number): Parsed<string | undefined> => {
  if (raw === undefined || raw === '') return { ok: true, value: undefined };
  return typeof raw === 'string' && raw.trim().length <= max ? { ok: true, value: raw.trim() || undefined } : { ok: false, error: `${name} must be at most ${max} characters` };
};
const date = (raw: unknown, name: string): Parsed<Date | undefined> => {
  if (raw === undefined || raw === '') return { ok: true, value: undefined };
  const d = typeof raw === 'string' ? new Date(raw) : new Date(NaN);
  return Number.isNaN(+d) ? { ok: false, error: `${name} must be an ISO date` } : { ok: true, value: d };
};
const all = <T extends Record<string, Parsed<any>>>(parts: T): Parsed<{ [K in keyof T]: T[K] extends Parsed<infer V> ? V : never }> => {
  const out: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(parts)) { if (!p.ok) return { ok: false, error: p.error }; out[k] = p.value; }
  return { ok: true, value: out as never };
};

export const isUuidValue = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

export function parseSubmissionQuery(q: Record<string, unknown>) {
  const status = q.status === undefined || q.status === '' ? { ok: true as const, value: undefined } : (ATTEMPT_STATUSES as readonly string[]).includes(String(q.status)) ? { ok: true as const, value: String(q.status) } : { ok: false as const, error: 'status is not a valid attempt status' };
  return all({ page: int(q.page, 'page', 1, 10_000, 1), pageSize: int(q.pageSize, 'pageSize', 1, 100, 25), search: text(q.search, 'search', 100), status });
}
export const submissionWhere = (organizationId: string, examId: string, f: { status?: string; search?: string }) => ({
  organizationId, examId, ...(f.status ? { status: f.status } : {}), ...(f.search ? { candidate: { name: { contains: f.search, mode: 'insensitive' as const } } } : {}),
});

export function parseAuditQuery(q: Record<string, unknown>) {
  return all({ page: int(q.page, 'page', 1, 10_000, 1), pageSize: int(q.pageSize, 'pageSize', 1, 100, 50), action: text(q.action, 'action', 60), from: date(q.from, 'from'), to: date(q.to, 'to') });
}
export const auditWhere = (organizationId: string, f: { action?: string; from?: Date; to?: Date }) => ({
  organizationId, ...(f.action ? { action: { startsWith: f.action } } : {}), ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
});

/**
 * What a teacher sees for one question when reviewing an attempt. Answer keys are included for objective questions
 * (the teacher authored them); coding questions never expose test data, only what the candidate submitted.
 */
export const OBJECTIVE_TYPES = ['mcq', 'multiple_select', 'true_false', 'short_answer'];
export function projectReviewQuestion(q: { id: string; type: string; prompt: string; options?: unknown; correctAnswer?: unknown; marks: number; negativeMarks: number; position: number | null }, answer: unknown) {
  const objective = OBJECTIVE_TYPES.includes(q.type);
  return { id: q.id, type: q.type, prompt: q.prompt, options: q.options ?? null, marks: q.marks, negativeMarks: q.negativeMarks, position: q.position, objective, correctAnswer: objective ? q.correctAnswer ?? null : null, answer: answer ?? null };
}
