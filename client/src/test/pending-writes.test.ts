import { describe, expect, it } from "vitest";
import { PendingWrites } from "../lib/pending-writes";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("pending monitoring writes", () => {
  it("flushes writes already in flight and writes queued before the flush completes", async () => {
    const writes = new PendingWrites();
    const first = deferred();
    const second = deferred();
    writes.track(first.promise);
    let flushed = false;
    const flush = writes.flush().then(() => { flushed = true; });

    await Promise.resolve();
    expect(flushed).toBe(false);
    writes.track(second.promise);
    first.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(flushed).toBe(false);
    second.resolve();
    await flush;
    expect(flushed).toBe(true);
  });

  it("continues draining after a failed monitoring write", async () => {
    const writes = new PendingWrites();
    writes.track(Promise.reject(new Error("network interrupted")));
    await expect(writes.flush()).resolves.toBeUndefined();
  });
});
