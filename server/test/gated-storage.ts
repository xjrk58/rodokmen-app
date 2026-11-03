import { systemClock, type Clock } from '../src/clock.js';
import { MemoryImageStorage } from '../src/storage/images.js';

/**
 * The bucket in memory, where a test can hold up the reads of a key until it lets them go, and
 * see every read and write in the order they happened.
 */
export class GatedStorage extends MemoryImageStorage {
  /** `get <key>` and `put <key>`, in order. */
  readonly log: string[] = [];
  /** The signal each read of a key was given, the last one. */
  readonly signals = new Map<string, AbortSignal | undefined>();
  private readonly holds = new Map<string, { held: Promise<void>; release: () => void }>();

  constructor(clock: Clock = systemClock) {
    super(clock);
  }

  /** Reads of `key` wait from now until the returned function (or releaseAll) is called. */
  hold(key: string): () => void {
    let resolve!: () => void;
    const held = new Promise<void>((r) => (resolve = r));
    const release = () => {
      if (this.holds.get(key)?.held === held) this.holds.delete(key);
      resolve();
    };
    this.holds.set(key, { held, release });
    return release;
  }

  /**
   * Lets every held read go. The image queue is the module's, shared by a test file's tests: a
   * test that failed while holding a read must not leave the ones after it waiting (#99).
   */
  releaseAll(): void {
    for (const { release } of [...this.holds.values()]) release();
  }

  override async get(storageKey: string, signal?: AbortSignal): Promise<Buffer | null> {
    this.log.push(`get ${storageKey}`);
    this.signals.set(storageKey, signal);
    await this.holds.get(storageKey)?.held;
    return super.get(storageKey);
  }

  override async put(storageKey: string, body: Buffer, contentType: string): Promise<void> {
    this.log.push(`put ${storageKey}`);
    return super.put(storageKey, body, contentType);
  }
}
