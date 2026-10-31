/**
 * Runs tasks one at a time, in the order they were queued. A task that fails rejects only its
 * own promise; the next one runs as usual.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private count = 0;

  /** Tasks waiting or running. */
  get size(): number {
    return this.count;
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    this.count += 1;
    const result = this.tail.then(task).finally(() => {
      this.count -= 1;
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
}
