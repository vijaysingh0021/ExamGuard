import { describe, expect, it } from "vitest";
import { AnswerSync } from "../lib/answer-sync";
import { createSubmitter } from "../lib/submit-flow";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const interpret = (e: unknown) => ({ receiptCode: (e as any)?.receiptCode, message: (e as any)?.error });

/**
 * A model of the SERVER rules this client depends on (answers.ts + the submit route): saves and submit serialize on the attempt row,
 * saving after the attempt is closed is rejected (409), and submitting twice returns the existing receipt instead of a second submission.
 * It is a model, not the real server; the real route is covered separately in the report.
 */
function modelServer(opts: { latency?: number } = {}) {
  const st = { answers: {} as Record<string, unknown>, status: "in_progress", receipt: null as string | null, submits: 0, accepted: [] as Array<[string, unknown]>, lock: Promise.resolve() };
  const locked = <T>(fn: () => Promise<T> | T): Promise<T> => { const run = st.lock.then(async () => { await sleep(opts.latency ?? 1); return fn(); }); st.lock = run.then(() => undefined, () => undefined); return run; };
  return {
    st,
    save: (q: string, v: unknown) => locked(() => { if (st.status !== "in_progress") throw { status: 409 }; st.answers[q] = v; st.accepted.push([q, v]); }),
    submit: () => locked(() => {
      if (st.status !== "in_progress") throw { receiptCode: st.receipt, error: "Attempt already submitted" };
      st.status = "submitted"; st.receipt = "EG-TEST-1"; st.submits++; return { status: "submitted", receiptCode: st.receipt };
    }),
  };
}

describe("simultaneous autosave and submission", () => {
  it("every answer typed before submit is stored, even when saves are still in flight", async () => {
    const m = modelServer({ latency: 8 });
    const sync = new AnswerSync({ save: async (q, v) => { await m.save(q, v); }, debounceMs: 700 });
    const sub = createSubmitter({ flush: () => sync.flush(), post: () => m.submit(), interpretError: interpret });
    sync.set("q1", "one"); sync.set("q2", "two"); sync.set("q3", ["a", "b"]); sync.set("essay", "typed a moment ago and never blurred");
    const out = await sub.run(false);
    expect(out.kind).toBe("submitted");
    expect(m.st.answers).toEqual({ q1: "one", q2: "two", q3: ["a", "b"], essay: "typed a moment ago and never blurred" });
    expect(m.st.submits).toBe(1);
  });

  it("an edit made WHILE the submit flush is running is still included", async () => {
    const m = modelServer({ latency: 10 });
    const sync = new AnswerSync({ save: async (q, v) => { await m.save(q, v); } });
    const sub = createSubmitter({ flush: () => sync.flush(), post: () => m.submit(), interpretError: interpret });
    sync.set("q1", "v1");
    const running = sub.run(false);
    await sleep(3); sync.set("q1", "v2"); // typed during the flush
    const out = await running;
    expect(out.kind).toBe("submitted");
    expect(m.st.answers.q1).toBe("v2");
  });

  it("double-clicking submit sends exactly one request, and later calls are no-ops", async () => {
    const m = modelServer(); const sync = new AnswerSync({ save: async (q, v) => { await m.save(q, v); } });
    const sub = createSubmitter({ flush: () => sync.flush(), post: () => m.submit(), interpretError: interpret });
    const [a, b, c] = await Promise.all([sub.run(false), sub.run(false), sub.run(true)]);
    expect([a.kind, b.kind, c.kind].filter((k) => k === "submitted")).toHaveLength(1);
    expect([a.kind, b.kind, c.kind].filter((k) => k === "busy")).toHaveLength(2);
    expect((await sub.run(false)).kind).toBe("done");
    expect(m.st.submits).toBe(1);
  });

  it("a second tab submitting first yields the existing receipt, not an error or a duplicate", async () => {
    const m = modelServer(); await m.submit(); // another tab already submitted
    const sub = createSubmitter({ flush: async () => true, post: () => m.submit(), interpretError: interpret });
    const out = await sub.run(false);
    expect(out).toEqual({ kind: "already_submitted", receipt: "EG-TEST-1" });
    expect(m.st.submits).toBe(1);
  });
});

describe("closed or expired attempts", () => {
  it("reject further answers and the engine stops retrying (nothing silently queued forever)", async () => {
    const m = modelServer(); m.st.status = "expired";
    const sync = new AnswerSync({ save: async (q, v) => { await m.save(q, v); }, isClosedError: (e) => (e as any)?.status === 409 });
    sync.set("q1", "late"); await sleep(15);
    expect(sync.snapshot().phase).toBe("closed");
    expect(m.st.accepted).toHaveLength(0);
    expect(await sync.flush()).toBe(false); // honestly reports that the late answer was not stored
  });
});

describe("never losing saved answers", () => {
  it("a manual submit is BLOCKED (not sent) while answers cannot be saved, and works after reconnecting", async () => {
    const m = modelServer(); let online = false;
    const sync = new AnswerSync({ save: async (q, v) => { if (!online) throw new Error("offline"); await m.save(q, v); } });
    const sub = createSubmitter({ flush: () => sync.flush(), post: () => m.submit(), interpretError: interpret });
    sync.set("q1", "important");
    expect((await sub.run(false)).kind).toBe("blocked_unsaved");
    expect(m.st.submits).toBe(0); expect(m.st.status).toBe("in_progress");
    online = true;
    expect((await sub.run(false)).kind).toBe("submitted");
    expect(m.st.answers.q1).toBe("important");
    sync.dispose();
  });

  it("the automatic deadline submit proceeds even offline (the server closes the attempt regardless), and reports it", async () => {
    const m = modelServer(); const sync = new AnswerSync({ save: async () => { throw new Error("offline"); } });
    const sub = createSubmitter({ flush: () => sync.flush(), post: () => m.submit(), interpretError: interpret });
    sync.set("q1", "x");
    expect((await sub.run(true)).kind).toBe("submitted");
    expect(sync.pendingCount()).toBe(1); // the UI can still tell the candidate that one answer did not reach the server
    sync.dispose();
  });

  it("a failed submit releases the guard so the candidate can retry", async () => {
    let fail = true; const sub = createSubmitter({ flush: async () => true, post: async () => { if (fail) throw { error: "Service unavailable" }; return { status: "submitted", receiptCode: "R" }; }, interpretError: interpret });
    expect(await sub.run(false)).toEqual({ kind: "error", message: "Service unavailable" });
    expect(sub.completed).toBe(false); fail = false;
    expect((await sub.run(false)).kind).toBe("submitted");
  });

  it("marks a deadline-closed submission as expired", async () => {
    const sub = createSubmitter({ flush: async () => true, post: async () => ({ status: "expired", receiptCode: "R2" }), interpretError: interpret });
    expect(await sub.run(true)).toEqual({ kind: "expired", receipt: "R2" });
  });
});
