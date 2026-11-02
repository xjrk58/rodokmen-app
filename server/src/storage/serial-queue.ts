/** The refusal of a SerialQueue that already holds as many tasks as it may. */
export class QueueFull extends Error {
  constructor(readonly limit: number) {
    super(`The queue already holds ${limit} tasks.`);
    this.name = 'QueueFull';
  }
}

/** Why a skipped task did not run: its signal's reason. */
const skipped = (signal: AbortSignal): Error => (signal.reason instanceof Error ? signal.reason : new Error('The task was skipped.'));

/**
 * Runs tasks one at a time, in the order they were queued. A task that fails rejects only its
 * own promise; the next one runs as usual.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private count = 0;

  /** @param limit the most tasks waiting or running at once; one more is refused. */
  constructor(private readonly limit = Infinity) {}

  /** Tasks waiting or running. */
  get size(): number {
    return this.count;
  }

  /**
   * Queues `task`, or rejects at once with QueueFull. When `skip` aborts before the task's turn
   * (its request was closed, say), its place is free at once, the task never runs, and its
   * promise rejects with the signal's reason. Once the task runs, `skip` no longer matters.
   */
  run<T>(task: () => Promise<T>, skip?: AbortSignal): Promise<T> {
    if (skip?.aborted) return Promise.reject(skipped(skip));
    if (this.count >= this.limit) return Promise.reject(new QueueFull(this.limit));
    this.count += 1;
    let counted = true;
    const leave = () => {
      if (counted) this.count -= 1;
      counted = false;
    };
    skip?.addEventListener('abort', leave, { once: true });
    const result = this.tail
      .then(() => {
        skip?.removeEventListener('abort', leave);
        if (skip?.aborted) throw skipped(skip);
        return task();
      })
      .finally(leave);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
