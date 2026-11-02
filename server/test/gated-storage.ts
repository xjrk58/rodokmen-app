import { systemClock, type Clock } from '../src/clock.js';
import { MemoryImageStorage } from '../src/storage/images.js';

/**
 * The bucket in memory, where a test can hold up the reads of a key until it lets them go, and
 * see every read and write in the order they happened.
 */
export class GatedStorage extends MemoryImageStorage {
  /** `get <key>` and `put <key>`, in order. */
  readonly log: string[] = [];
  private readonly holds = new Map<string, Promise<void>>();

  constructor(clock: Clock = systemClock) {
    super(clock);
  }

  /** Reads of `key` wait from now until the returned function is called. */
  hold(key: string): () => void {
    let release!: () => void;
    this.holds.set(key, new Promise<void>((resolve) => (release = resolve)));
    return () => {
      this.holds.delete(key);
      release();
    };
  }

  override async get(storageKey: string): Promise<Buffer | null> {
    this.log.push(`get ${storageKey}`);
    await this.holds.get(storageKey);
    return super.get(storageKey);
  }

  override async put(storageKey: string, body: Buffer, contentType: string): Promise<void> {
    this.log.push(`put ${storageKey}`);
    return super.put(storageKey, body, contentType);
  }
}
