import { canDecideIncidents, canManageExams, canReviewVerifications } from "./permissions";

/** Pure rules for the staff overview: which real, actionable items to surface for a role, and a summary of the exam list. */
export interface Stats { exams: number; candidates: number; verificationPending: number; openIncidents: number; activeSessions: number; pendingExplanations: number; awaitingEvaluation?: number; pendingManual?: number; readyToPublish?: number }
export interface AttentionItem { id: string; label: string; count: number; path: string; urgent: boolean }

/** Only items with something to do, and only those the role can act on (the server remains authoritative). */
export function attentionItems(stats: Stats, role: string): AttentionItem[] {
  const items: AttentionItem[] = [];
  const add = (id: string, label: string, count: number | undefined, path: string, urgent = false) => { if (count && count > 0) items.push({ id, label, count, path, urgent }); };
  if (canManageExams(role)) {
    add("evaluate", "Submissions waiting to be evaluated", stats.awaitingEvaluation, "/app/exams", true);
    add("mark", "Answers waiting for manual marking", stats.pendingManual, "/app/exams", true);
    add("publish", "Results ready to publish", stats.readyToPublish, "/app/exams");
  }
  add("incidents", "Incidents awaiting review", stats.openIncidents, "/app/incidents", true);
  add("explanations", "Candidate explanations to read", stats.pendingExplanations, "/app/incidents");
  if (canReviewVerifications(role)) add("verification", "Identity verifications to review", stats.verificationPending, "/app/verification");
  if (canDecideIncidents(role) || canManageExams(role)) add("sessions", "Exams in progress right now", stats.activeSessions, "/app/monitoring");
  return items;
}

export interface ExamLite { id: string; title: string; status: string; startsAt?: string | null; endsAt?: string | null }
export function examOverview(exams: ExamLite[], nowMs: number) {
  const byStatus: Record<string, number> = {};
  for (const e of exams) byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
  const t = (v?: string | null) => (v ? new Date(v).getTime() : undefined);
  const liveNow = exams.filter((e) => ["published", "scheduled", "live"].includes(e.status) && (t(e.startsAt) ?? 0) <= nowMs && (t(e.endsAt) === undefined || nowMs < t(e.endsAt)!));
  const upcoming = exams.filter((e) => ["published", "scheduled"].includes(e.status) && t(e.startsAt) !== undefined && t(e.startsAt)! > nowMs).sort((a, b) => t(a.startsAt)! - t(b.startsAt)!);
  return { byStatus, liveNow, next: upcoming[0] ?? null, upcomingCount: upcoming.length };
}
export const STATUS_LABEL: Record<string, string> = { draft: "Draft", published: "Published", scheduled: "Scheduled", live: "Live", completed: "Completed" };
