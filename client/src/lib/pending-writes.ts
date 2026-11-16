export class PendingWrites {
  private readonly pending = new Set<Promise<unknown>>();

  track<T>(work: Promise<T>): Promise<T> {
    let tracked: Promise<T>;
    tracked = work.finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
    return tracked;
  }

  async flush(): Promise<void> {
    while (this.pending.size) {
      await Promise.allSettled([...this.pending]);
    }
  }
}
