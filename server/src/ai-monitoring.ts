/** Review-signal confirmation for a rolling five-frame camera window. */
const histories = new Map<string, Map<string, boolean[]>>();

export function aiSignalsForFrame(
  attemptId: string,
  values: Record<string, boolean>,
): string[] {
  let attemptHistory = histories.get(attemptId);
  if (!attemptHistory) {
    attemptHistory = new Map<string, boolean[]>();
    histories.set(attemptId, attemptHistory);
  }

  const qualified: string[] = [];
  for (const [signal, positive] of Object.entries(values)) {
    const samples = attemptHistory.get(signal) ?? [];
    samples.push(positive);
    if (samples.length > 5) samples.shift();
    attemptHistory.set(signal, samples);
    if (positive && samples.filter(Boolean).length >= 3) qualified.push(signal);
  }

  // Bound process memory for long-running local instances.
  if (histories.size > 5000) histories.delete(histories.keys().next().value as string);
  return qualified;
}

export function clearAiSignalHistory(attemptId?: string): void {
  if (attemptId) histories.delete(attemptId);
  else histories.clear();
}
