import { isAnswerCorrect } from './grading.js';

/** Pure aggregation over rows that were already fetched with organization-scoped queries. Nothing here touches the database. */
export interface AttemptRow { status: string; startedAt: Date; submittedAt: Date | null }
export interface GradeRow { totalMarks: number; maxMarks: number; status: string }
export interface QuestionRow { id: string; type: string; prompt: string; position: number | null; correctAnswer: unknown }
export interface AnswerRow { questionId: string; value: unknown }

const round = (n: number, places = 1) => Math.round(n * 10 ** places) / 10 ** places;
const median = (sorted: number[]) => (sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : null);

export function participation(assigned: number, attempts: AttemptRow[]) {
  const count = (...s: string[]) => attempts.filter(a => s.includes(a.status)).length;
  const finished = count('submitted', 'expired');
  return {
    assigned, started: attempts.length, notStarted: Math.max(0, assigned - attempts.length), inProgress: count('in_progress', 'paused'),
    submitted: count('submitted'), closedAtDeadline: count('expired'), terminated: count('terminated'),
    completionRate: assigned ? round(finished / assigned, 3) : 0,
  };
}

export function durations(attempts: AttemptRow[]) {
  const minutes = attempts.filter(a => ['submitted', 'expired'].includes(a.status) && a.submittedAt && a.submittedAt >= a.startedAt)
    .map(a => (a.submittedAt!.getTime() - a.startedAt.getTime()) / 60_000).sort((a, b) => a - b);
  if (!minutes.length) return { samples: 0, averageMinutes: null, medianMinutes: null, minMinutes: null, maxMinutes: null };
  return { samples: minutes.length, averageMinutes: round(minutes.reduce((s, m) => s + m, 0) / minutes.length), medianMinutes: round(median(minutes)!), minMinutes: round(minutes[0]), maxMinutes: round(minutes[minutes.length - 1]) };
}

/** Only complete grades count: grades still waiting for manual marking would skew averages downward. */
export function scores(grades: GradeRow[]) {
  const done = grades.filter(g => ['graded', 'published'].includes(g.status) && g.maxMarks > 0);
  const pct = done.map(g => Math.max(0, Math.min(100, (g.totalMarks / g.maxMarks) * 100))).sort((a, b) => a - b);
  const buckets = Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: i === 9 ? 100 : i * 10 + 9, count: 0 }));
  for (const p of pct) buckets[Math.min(9, Math.floor(p / 10))].count++;
  return { graded: done.length, pendingManual: grades.filter(g => g.status === 'pending_manual').length, averagePercent: pct.length ? round(pct.reduce((s, p) => s + p, 0) / pct.length) : null, medianPercent: pct.length ? round(median(pct)!) : null, distribution: buckets };
}

export function questionPerformance(questions: QuestionRow[], answers: AnswerRow[], attemptsStarted: number) {
  const byQuestion = new Map<string, unknown[]>();
  for (const a of answers) { const list = byQuestion.get(a.questionId) ?? []; list.push(a.value); byQuestion.set(a.questionId, list); }
  return questions.filter(q => q.correctAnswer != null && ['mcq', 'multiple_select', 'true_false', 'short_answer'].includes(q.type))
    .map(q => {
      const given = (byQuestion.get(q.id) ?? []).filter(v => v != null);
      const correct = given.filter(v => isAnswerCorrect(v, q.correctAnswer)).length;
      return { questionId: q.id, position: q.position, type: q.type, prompt: q.prompt.length > 80 ? `${q.prompt.slice(0, 77)}…` : q.prompt, answered: given.length, skipped: Math.max(0, attemptsStarted - given.length), correct, correctRate: given.length ? round(correct / given.length, 3) : null };
    }).sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9));
}

/** Parses an optional ISO date query value. Invalid input is an error, never silently ignored. */
export function parseDateParam(raw: unknown): Date | undefined | 'invalid' {
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string') return 'invalid';
  const d = new Date(raw); return Number.isNaN(+d) ? 'invalid' : d;
}
