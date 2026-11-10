/** Pure helpers for the examination screen: server-aligned timer, answer status, progress and persisted review marks. */

/** Offset (ms) to ADD to the device clock to get server time, from an HTTP Date header. Unusable values give 0. */
export function clockOffsetMs(dateHeader: string | undefined | null, clientNowMs: number): number {
  if (!dateHeader) return 0;
  const server = Date.parse(dateHeader);
  if (Number.isNaN(server)) return 0;
  const offset = server - clientNowMs;
  return Math.abs(offset) > 12 * 3_600_000 ? 0 : Math.round(offset); // an offset this large is a bad header, not a real clock
}
export const remainingMs = (deadlineIso: string, clientNowMs: number, offsetMs = 0) => Math.max(0, new Date(deadlineIso).getTime() - (clientNowMs + offsetMs));

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}
export type TimerTone = "normal" | "warning" | "critical" | "expired";
export const timerTone = (ms: number): TimerTone => (ms <= 0 ? "expired" : ms <= 60_000 ? "critical" : ms <= 10 * 60_000 ? "warning" : "normal");
/** Screen-reader announcements are limited to meaningful moments rather than every second. */
export const timerAnnouncement = (ms: number): string | null => {
  const s = Math.ceil(ms / 1000);
  if (s <= 0) return "Time is up.";
  if (s === 60) return "One minute remaining.";
  if (s === 300) return "Five minutes remaining.";
  if (s === 600) return "Ten minutes remaining.";
  return null;
};

export function isAnswered(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return value != null;
}
export function progress(questions: Array<{ id: string }>, answers: Record<string, unknown>, marked: Record<string, boolean>) {
  const unanswered: number[] = [];
  questions.forEach((q, i) => { if (!isAnswered(answers[q.id])) unanswered.push(i); });
  const markedIndexes = questions.map((q, i) => (marked[q.id] ? i : -1)).filter((i) => i >= 0);
  return { total: questions.length, answered: questions.length - unanswered.length, unanswered, marked: markedIndexes };
}
export type QuestionState = "current" | "marked" | "answered" | "unanswered";
export const questionState = (isCurrent: boolean, isMarked: boolean, answered: boolean): QuestionState => (isCurrent ? "current" : isMarked ? "marked" : answered ? "answered" : "unanswered");

/** Review marks survive a page reload (sessionStorage). Storage is injected so failures never break the exam. */
export interface KeyValueStore { getItem(k: string): string | null; setItem(k: string, v: string): void }
const marksKey = (attemptId: string) => `eg-review-marks:${attemptId}`;
export function loadMarks(store: KeyValueStore | undefined, attemptId: string): Record<string, boolean> {
  try {
    const raw = store?.getItem(marksKey(attemptId)); if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown; if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter(([, v]) => v === true)) as Record<string, boolean>;
  } catch { return {}; }
}
export function saveMarks(store: KeyValueStore | undefined, attemptId: string, marks: Record<string, boolean>) {
  try { store?.setItem(marksKey(attemptId), JSON.stringify(Object.fromEntries(Object.entries(marks).filter(([, v]) => v)))); } catch { /* storage unavailable: marks are a convenience only */ }
}
