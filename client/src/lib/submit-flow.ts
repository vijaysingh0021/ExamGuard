/**
 * Final-submission orchestration for the examination screen. Guarantees:
 *  - answers are flushed to the server BEFORE the submit request (nothing typed is left behind);
 *  - a manual submit is blocked, not lost, while answers are still unsaved; an automatic (deadline) submit proceeds anyway;
 *  - only one submission runs at a time, and once it succeeds every later call is a no-op (no double submission);
 *  - a failed submit releases the guard so the candidate can retry.
 * The server remains the authority (row-locked, idempotent); this only prevents the client from racing itself.
 */
export type SubmitOutcome =
  | { kind: "submitted" | "expired"; receipt: string }
  | { kind: "already_submitted"; receipt: string }
  | { kind: "blocked_unsaved" }
  | { kind: "busy" }
  | { kind: "done" }
  | { kind: "error"; message: string };

export interface SubmitDeps {
  flush: () => Promise<boolean>;
  post: () => Promise<{ status?: string; receiptCode?: string | null }>;
  /** Interpret a failed POST: a receipt means the server had already recorded the submission. */
  interpretError: (error: unknown) => { receiptCode?: string; message?: string };
}

export function createSubmitter(deps: SubmitDeps) {
  let running = false;
  let completed = false;
  return {
    get completed() { return completed; },
    async run(automatic = false): Promise<SubmitOutcome> {
      if (completed) return { kind: "done" };
      if (running) return { kind: "busy" };
      running = true;
      try {
        const saved = await deps.flush();
        if (!saved && !automatic) return { kind: "blocked_unsaved" };
        try {
          const data = await deps.post();
          completed = true;
          return { kind: data.status === "expired" ? "expired" : "submitted", receipt: data.receiptCode ?? "Submission processed" };
        } catch (error) {
          const info = deps.interpretError(error);
          if (info.receiptCode) { completed = true; return { kind: "already_submitted", receipt: info.receiptCode }; }
          return { kind: "error", message: info.message ?? "Submission could not be confirmed. Please try again." };
        }
      } finally { running = false; }
    },
  };
}
