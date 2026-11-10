export type ExplanationRequestStatus = 'requested' | 'responded' | 'follow_up' | 'closed';
export type ExplanationDecision = 'accepted' | 'dismissed' | 'escalated';
export type ExplanationAction = ExplanationDecision | 'follow_up';

export function explanationResponseOpen(status: string, deadlineAt: Date | null | undefined, now = new Date()): boolean {
  return (status === 'requested' || status === 'follow_up') && (!deadlineAt || deadlineAt > now);
}

export function explanationStatusLabel(status: ExplanationRequestStatus, decision?: ExplanationDecision | null): string {
  if (status === 'requested') return 'Awaiting student response';
  if (status === 'responded') return 'Response received';
  if (status === 'follow_up') return 'Additional information requested';
  if (decision === 'accepted') return 'Explanation accepted';
  if (decision === 'dismissed') return 'Incident dismissed';
  if (decision === 'escalated') return 'Escalated for review';
  return 'Reviewed';
}

export function incidentStatusForExplanation(action: ExplanationAction): 'resolved' | 'dismissed' | 'escalated' | 'awaiting_student' {
  if (action === 'accepted') return 'resolved';
  if (action === 'dismissed') return 'dismissed';
  if (action === 'escalated') return 'escalated';
  return 'awaiting_student';
}

export function validExplanationDeadline(deadlineAt: Date, now = new Date()): boolean {
  return deadlineAt > now && deadlineAt <= new Date(now.getTime() + 30 * 24 * 3600_000);
}
