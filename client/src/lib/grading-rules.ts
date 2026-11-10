/** Pure grading-workflow rules for the teacher UI. The server enforces the same bounds; this only drives affordances and messages. */
export type GradeStatus = "pending_manual" | "graded" | "published";
export interface GradeLite { id: string; status: GradeStatus; autoMarks: number; manualMarks: number; totalMarks: number; maxMarks: number }

export function gradeActions(attemptStatus: string, grade: GradeLite | null) {
  const finished = attemptStatus === "submitted" || attemptStatus === "expired";
  const published = grade?.status === "published";
  return {
    canEvaluate: finished && !published,
    evaluateLabel: grade ? "Re-run automatic grading" : "Evaluate automatically",
    canMark: !!grade && !published,
    canPublish: grade?.status === "graded",
    locked: published,
    needsMarking: grade?.status === "pending_manual",
  };
}

/** Manual marks are added to automatic marks, so the most that can be awarded is what remains of the maximum. */
export const maxManualMarks = (g: Pick<GradeLite, "autoMarks" | "maxMarks">) => Math.max(0, Math.round((g.maxMarks - g.autoMarks) * 100) / 100);

export function parseManualMarks(raw: string, g: Pick<GradeLite, "autoMarks" | "maxMarks">): { ok: true; value: number } | { ok: false; error: string } {
  const text = raw.trim();
  if (!text) return { ok: false, error: "Enter the marks to award." };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { ok: false, error: "Use a number such as 4 or 3.5 (up to two decimals)." };
  const value = Number(text); const max = maxManualMarks(g);
  if (value > max) return { ok: false, error: `Marks can't exceed ${max} (the exam maximum is ${g.maxMarks}, with ${g.autoMarks} already awarded automatically).` };
  return { ok: true, value };
}

export const percent = (total: number, max: number) => (max > 0 ? Math.round((total / max) * 1000) / 10 : null);
export const formatScore = (g: Pick<GradeLite, "totalMarks" | "maxMarks">) => `${g.totalMarks} / ${g.maxMarks}`;

export const GRADE_STATUS_LABEL: Record<GradeStatus, string> = { pending_manual: "Needs marking", graded: "Ready to publish", published: "Published" };
export const ATTEMPT_STATUS_LABEL: Record<string, string> = { in_progress: "In progress", paused: "Paused", submitted: "Submitted", expired: "Closed at deadline", terminated: "Terminated" };
export const gradeTone = (s: GradeStatus) => (s === "published" ? "success" : s === "graded" ? "warning" : "outline") as "success" | "warning" | "outline";

/** Same equality the server uses for objective grading (order-insensitive for multiple choice). */
export const sameAnswer = (answer: unknown, correct: unknown) => {
  const n = (v: unknown) => JSON.stringify(Array.isArray(v) ? [...v].sort() : v);
  return answer != null && n(answer) === n(correct);
};
/** Human-readable text for an answer value, mapping option ids to their text. */
export function describeAnswer(value: unknown, options: Array<{ id: string; text: string }> | null): string {
  if (value == null || value === "") return "";
  const text = (v: unknown) => options?.find((o) => o.id === v)?.text ?? String(v);
  return Array.isArray(value) ? value.map(text).join(", ") : text(value);
}
