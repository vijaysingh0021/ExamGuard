/**
 * Candidate answer synchronisation. Guarantees:
 *  - at most ONE save request in flight per question, and always the LATEST value (the server is last-write-wins by arrival,
 *    so concurrent requests could otherwise let an older answer overwrite a newer one);
 *  - a failed save is kept and retried with backoff, and immediately when the browser comes back online;
 *  - flush() sends everything outstanding (bypassing the typing debounce) so submission never leaves typed text behind;
 *  - a "closed" response (attempt over) stops all retries.
 * Pure logic: no React, no network, timers are injectable for tests.
 */
export type SyncPhase = "saved" | "waiting" | "saving" | "retrying" | "closed";
export interface SyncSnapshot { phase: SyncPhase; pending: number; lastSavedAt: number | null; failures: number }
export interface TimerApi { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void }
/** Where unsent answers are kept so a reload, redirect to sign-in or crashed tab cannot lose them. */
export interface PendingStore { read(): Record<string, unknown>; write(pending: Record<string, unknown>): void; clear(): void }
/** sessionStorage-backed store for one attempt. Failures are swallowed: persistence is a safety net, never a dependency. */
export function pendingStore(storage: { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } | undefined, attemptId: string): PendingStore {
  const key = `eg-pending-answers:${attemptId}`;
  return {
    read() { try { const raw = storage?.getItem(key); const v = raw ? JSON.parse(raw) : {}; return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}; } catch { return {}; } },
    write(pending) { try { if (Object.keys(pending).length) storage?.setItem(key, JSON.stringify(pending)); else storage?.removeItem(key); } catch { /* storage unavailable */ } },
    clear() { try { storage?.removeItem(key); } catch { /* storage unavailable */ } },
  };
}

export interface AnswerSyncOptions {
  /** Optional durable copy of answers that have not reached the server yet. */
  persist?: PendingStore;
  save: (questionId: string, value: unknown) => Promise<void>;
  /** True when the error means the attempt is closed and retrying is pointless (HTTP 409/404). */
  isClosedError?: (error: unknown) => boolean;
  onChange?: (snapshot: SyncSnapshot) => void;
  debounceMs?: number;
  retryDelayMs?: (failures: number) => number;
  timers?: TimerApi;
  now?: () => number;
}

const defaultTimers: TimerApi = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
export const defaultRetryDelay = (failures: number) => Math.min(1000 * 2 ** Math.max(0, failures - 1), 15_000);

export class AnswerSync {
  private desired = new Map<string, { value: unknown; version: number }>();
  private sent = new Map<string, number>();
  private inflight = new Map<string, Promise<void>>();
  private debounce = new Map<string, unknown>();
  private retryHandle: unknown;
  private version = 0;
  private failures = 0;
  private lastSavedAt: number | null = null;
  private closed = false;
  private disposed = false;
  private readonly timers: TimerApi;
  private readonly now: () => number;

  constructor(private opts: AnswerSyncOptions) { this.timers = opts.timers ?? defaultTimers; this.now = opts.now ?? Date.now; }

  /** Record the latest value for a question. Saved after a short pause, or immediately on flush(). */
  set(questionId: string, value: unknown, { immediate = false }: { immediate?: boolean } = {}) {
    if (this.closed || this.disposed) return;
    this.desired.set(questionId, { value, version: ++this.version });
    const pending = this.debounce.get(questionId); if (pending !== undefined) this.timers.clear(pending);
    this.persistNow();
    if (immediate || !this.opts.debounceMs) { this.debounce.delete(questionId); void this.send(questionId); }
    else this.debounce.set(questionId, this.timers.set(() => { this.debounce.delete(questionId); void this.send(questionId); }, this.opts.debounceMs));
    this.emit();
  }

  /** Unsent values, keyed by question. */
  private pendingValues() { const out: Record<string, unknown> = {}; for (const [q, d] of this.desired) if (d.version > (this.sent.get(q) ?? 0)) out[q] = d.value; return out; }
  private persistNow() { this.opts.persist?.write(this.pendingValues()); }

  /** Re-queue answers that were pending when the page was last closed or reloaded. Returns what was restored so the UI can show it. */
  restore(): Record<string, unknown> {
    const restored = this.opts.persist?.read() ?? {};
    for (const [q, v] of Object.entries(restored)) if (!this.desired.has(q)) this.set(q, v, { immediate: true });
    return restored;
  }
  /** Forget the durable copy (after a successful final submission). */
  clearPersisted() { this.opts.persist?.clear(); }

  pendingCount() { let n = 0; for (const [q, d] of this.desired) if (d.version > (this.sent.get(q) ?? 0)) n++; return n; }
  snapshot(): SyncSnapshot {
    const pending = this.pendingCount();
    const phase: SyncPhase = this.closed ? "closed" : this.inflight.size ? "saving" : pending === 0 ? "saved" : this.failures > 0 ? "retrying" : "waiting";
    return { phase, pending, lastSavedAt: this.lastSavedAt, failures: this.failures };
  }

  /** Send everything outstanding now. Resolves true only when nothing remains unsaved. */
  async flush(): Promise<boolean> {
    for (const h of this.debounce.values()) this.timers.clear(h);
    this.debounce.clear();
    const work: Promise<void>[] = [];
    for (const [q, d] of this.desired) if (d.version > (this.sent.get(q) ?? 0)) work.push(this.send(q));
    await Promise.all(work);
    return this.pendingCount() === 0;
  }

  /** Call when the browser reports it is online again. */
  retryNow() { if (this.retryHandle !== undefined) { this.timers.clear(this.retryHandle); this.retryHandle = undefined; } void this.flush(); }

  dispose() { this.disposed = true; for (const h of this.debounce.values()) this.timers.clear(h); this.debounce.clear(); if (this.retryHandle !== undefined) this.timers.clear(this.retryHandle); this.retryHandle = undefined; }

  private send(questionId: string): Promise<void> {
    const running = this.inflight.get(questionId);
    if (running) return running; // its loop re-reads the latest value when the current request finishes
    const task = (async () => {
      try {
        while (!this.closed && !this.disposed) {
          const d = this.desired.get(questionId);
          if (!d || (this.sent.get(questionId) ?? 0) >= d.version) break;
          await this.opts.save(questionId, d.value);
          this.sent.set(questionId, d.version); this.failures = 0; this.lastSavedAt = this.now(); this.persistNow();
        }
      } catch (error) {
        if (this.opts.isClosedError?.(error)) this.closed = true;
        else { this.failures++; this.scheduleRetry(); }
      } finally { this.inflight.delete(questionId); this.emit(); }
    })();
    this.inflight.set(questionId, task);
    this.emit();
    return task;
  }

  private scheduleRetry() {
    if (this.retryHandle !== undefined || this.closed || this.disposed) return;
    const delay = (this.opts.retryDelayMs ?? defaultRetryDelay)(this.failures);
    this.retryHandle = this.timers.set(() => { this.retryHandle = undefined; void this.flush(); }, delay);
  }
  private emit() { if (!this.disposed) this.opts.onChange?.(this.snapshot()); }
}
