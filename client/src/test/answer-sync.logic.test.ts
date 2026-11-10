import { describe, expect, it } from "vitest";
import { AnswerSync, defaultRetryDelay, pendingStore, type TimerApi } from "../lib/answer-sync";

/** Deterministic timers so debounce and backoff can be stepped without waiting. */
class FakeTimers implements TimerApi {
  now = 0; private seq = 0; tasks: Array<{ id: number; at: number; fn: () => void }> = [];
  set(fn: () => void, ms: number) { const id = ++this.seq; this.tasks.push({ id, at: this.now + ms, fn }); return id; }
  clear(h: unknown) { this.tasks = this.tasks.filter((t) => t.id !== h); }
  async advance(ms: number) { const end = this.now + ms; for (;;) { const next = this.tasks.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0]; if (!next) break; this.now = next.at; this.tasks = this.tasks.filter((t) => t.id !== next.id); next.fn(); await settle(); } this.now = end; }
}
const settle = () => new Promise<void>((r) => setTimeout(r, 5));
const closed = (e: unknown) => (e as { status?: number })?.status === 409;

/** A fake server: records the order requests ARRIVE, can be taken offline, and can delay responses. */
function server() {
  const s = { online: true, stored: {} as Record<string, unknown>, log: [] as Array<[string, unknown]>, inflight: {} as Record<string, number>, maxParallel: 0, closed: false, delay: 0 };
  const save = async (q: string, v: unknown) => {
    s.inflight[q] = (s.inflight[q] ?? 0) + 1; s.maxParallel = Math.max(s.maxParallel, s.inflight[q]);
    await new Promise<void>((r) => setTimeout(r, s.delay));
    s.inflight[q]--;
    if (s.closed) throw { status: 409 };
    if (!s.online) throw new Error("network");
    s.log.push([q, v]); s.stored[q] = v;
  };
  return { s, save };
}

describe("AnswerSync", () => {
  it("never has two requests in flight for one question and the server ends with the latest value", async () => {
    const { s, save } = server(); s.delay = 5;
    const sync = new AnswerSync({ save, isClosedError: closed });
    for (const v of ["a", "ab", "abc", "abcd", "abcde"]) { sync.set("q1", v); await new Promise((r) => setTimeout(r, 1)); }
    expect(await sync.flush()).toBe(true);
    expect(s.maxParallel).toBe(1);
    expect(s.stored.q1).toBe("abcde");
    const seen = s.log.map(([, v]) => String(v).length); // values must never go backwards
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  it("debounces typing and sends only the final value", async () => {
    const t = new FakeTimers(); const { s, save } = server();
    const sync = new AnswerSync({ save, timers: t, debounceMs: 600 });
    sync.set("q1", "h"); await t.advance(300); sync.set("q1", "he"); await t.advance(300); sync.set("q1", "hey");
    expect(s.log).toHaveLength(0);
    expect(sync.snapshot().phase).toBe("waiting");
    await t.advance(600); await settle();
    expect(s.log).toEqual([["q1", "hey"]]);
    expect(sync.snapshot().phase).toBe("saved");
  });

  it("flush() sends typed-but-unsaved text immediately (the auto-submit at 0:00 case)", async () => {
    const t = new FakeTimers(); const { s, save } = server();
    const sync = new AnswerSync({ save, timers: t, debounceMs: 600 });
    sync.set("essay", "last words typed just before time ran out");
    expect(await sync.flush()).toBe(true);
    expect(s.stored.essay).toBe("last words typed just before time ran out");
  });

  it("keeps failed answers, retries with backoff, and recovers without the candidate doing anything", async () => {
    const t = new FakeTimers(); const { s, save } = server(); s.online = false;
    const sync = new AnswerSync({ save, timers: t });
    sync.set("q1", "A"); await settle();
    expect(sync.snapshot()).toEqual({ phase: "retrying", pending: 1, lastSavedAt: null, failures: 1 });
    await t.advance(1000); expect(sync.snapshot().failures).toBe(2);
    await t.advance(2000); expect(sync.snapshot().failures).toBe(3);
    s.online = true; await t.advance(4000); await settle();
    expect(s.stored.q1).toBe("A"); expect(sync.snapshot().phase).toBe("saved"); expect(sync.snapshot().pending).toBe(0);
  });

  it("flush() reports false while still offline so submission can warn instead of silently losing work", async () => {
    const { s, save } = server(); s.online = false;
    const sync = new AnswerSync({ save, timers: new FakeTimers() });
    sync.set("q1", "x");
    expect(await sync.flush()).toBe(false);
    expect(sync.pendingCount()).toBe(1);
    s.online = true; expect(await sync.flush()).toBe(true);
  });

  it("retryNow() (browser back online) retries immediately instead of waiting for backoff", async () => {
    const t = new FakeTimers(); const { s, save } = server(); s.online = false;
    const sync = new AnswerSync({ save, timers: t });
    sync.set("q1", "A"); await settle();
    s.online = true; sync.retryNow(); await settle(); await settle();
    expect(s.stored.q1).toBe("A");
  });

  it("a closed attempt (409) stops retries and ignores further input", async () => {
    const t = new FakeTimers(); const { s, save } = server(); s.closed = true;
    const sync = new AnswerSync({ save, timers: t, isClosedError: closed });
    sync.set("q1", "A"); await settle();
    expect(sync.snapshot().phase).toBe("closed");
    expect(t.tasks).toHaveLength(0);
    sync.set("q2", "B"); expect(sync.pendingCount()).toBe(1);
  });

  it("questions are independent: one failing does not block another", async () => {
    const t = new FakeTimers(); const s = { stored: {} as Record<string, unknown> };
    const save = async (q: string, v: unknown) => { if (q === "bad") throw new Error("x"); s.stored[q] = v; };
    const sync = new AnswerSync({ save, timers: t });
    sync.set("bad", 1); sync.set("good", 2); await settle();
    expect(s.stored.good).toBe(2); expect(sync.pendingCount()).toBe(1);
  });

  it("a value set while a save is in flight is sent next, never dropped", async () => {
    const { s, save } = server(); s.delay = 10;
    const sync = new AnswerSync({ save });
    sync.set("q1", "first"); await new Promise((r) => setTimeout(r, 2)); sync.set("q1", "second");
    expect(await sync.flush()).toBe(true);
    expect(s.stored.q1).toBe("second");
  });

  it("backoff grows and is capped", () => {
    expect([1, 2, 3, 4, 5, 10].map(defaultRetryDelay)).toEqual([1000, 2000, 4000, 8000, 15000, 15000]);
  });
});

const memStorage = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), raw: m }; };

describe("pending answers survive reloads, expired sessions and crashes", () => {
  it("are written when unsent and removed once the server has them", async () => {
    const t = new FakeTimers(); const { s, save } = server(); const store = memStorage(); s.online = false;
    const sync = new AnswerSync({ save, timers: t, persist: pendingStore(store, "att1") });
    sync.set("q1", "typed while offline"); await settle();
    expect(JSON.parse(store.getItem("eg-pending-answers:att1")!)).toEqual({ q1: "typed while offline" });
    s.online = true; await t.advance(1000); await settle();
    expect(s.stored.q1).toBe("typed while offline"); expect(store.getItem("eg-pending-answers:att1")).toBeNull(); sync.dispose();
  });

  it("a new page load (same tab) restores unsent answers and sends them", async () => {
    const store = memStorage(); const down = server(); down.s.online = false;
    const first = new AnswerSync({ save: down.save, timers: new FakeTimers(), persist: pendingStore(store, "att1") });
    first.set("q1", "unsent text"); first.set("q2", ["a", "b"]); await settle(); first.dispose(); // page left: in-memory state gone
    const up = server();
    const second = new AnswerSync({ save: up.save, persist: pendingStore(store, "att1") });
    const restored = second.restore();
    expect(restored).toEqual({ q1: "unsent text", q2: ["a", "b"] });
    expect(await second.flush()).toBe(true);
    expect(up.s.stored).toEqual({ q1: "unsent text", q2: ["a", "b"] }); expect(store.getItem("eg-pending-answers:att1")).toBeNull();
  });

  it("restoring never overrides something the candidate has already typed on the new page", async () => {
    const store = memStorage(); pendingStore(store, "att1").write({ q1: "old unsent" });
    const { s, save } = server(); const sync = new AnswerSync({ save, persist: pendingStore(store, "att1") });
    sync.set("q1", "newer text"); sync.restore(); expect(await sync.flush()).toBe(true); expect(s.stored.q1).toBe("newer text");
  });

  it("is per attempt: another attempt's pending answers are never restored", () => {
    const store = memStorage(); pendingStore(store, "attA").write({ q1: "A's answer" });
    expect(pendingStore(store, "attB").read()).toEqual({});
  });

  it("clearPersisted() removes the durable copy after a successful submission", () => {
    const store = memStorage(); const p = pendingStore(store, "att1"); p.write({ q1: "x" });
    const sync = new AnswerSync({ save: async () => {}, persist: p }); sync.clearPersisted(); expect(store.getItem("eg-pending-answers:att1")).toBeNull();
  });

  it("tolerates garbage, arrays and unavailable storage without throwing", () => {
    const store = memStorage(); store.setItem("eg-pending-answers:a", "{not json"); expect(pendingStore(store, "a").read()).toEqual({});
    store.setItem("eg-pending-answers:b", "[1,2]"); expect(pendingStore(store, "b").read()).toEqual({});
    const broken = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); }, removeItem() { throw new Error("denied"); } };
    const p = pendingStore(broken, "c"); expect(p.read()).toEqual({}); p.write({ q: 1 }); p.clear(); expect(pendingStore(undefined, "d").read()).toEqual({});
  });
});

