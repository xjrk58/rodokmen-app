// Least-recently-used index of cached map tiles, used by the service worker.
// It keeps tile URLs in use order (oldest first) and says which ones to drop
// when there are more than `capacity`. Storage is the caller's business.

export const TILE_CACHE_LIMIT = 2000;

export class TileLru {
  /**
   * @param {number} capacity
   * @param {Iterable<string>} [keys] known keys, oldest first
   */
  constructor(capacity, keys = []) {
    if (!(capacity > 0)) throw new Error('capacity must be positive');
    this.capacity = capacity;
    /** @type {Map<string, true>} insertion order is use order */
    this.order = new Map();
    for (const key of keys) this.order.set(key, true);
  }

  get size() {
    return this.order.size;
  }

  /** @param {string} key */
  has(key) {
    return this.order.has(key);
  }

  /**
   * Records a use of `key` (a read or a write) and returns the keys to evict,
   * least recently used first.
   * @param {string} key
   * @returns {string[]}
   */
  touch(key) {
    this.order.delete(key);
    this.order.set(key, true);
    return this.trim();
  }

  /** @param {string} key */
  delete(key) {
    return this.order.delete(key);
  }

  /** @returns {string[]} keys beyond capacity, least recently used first */
  trim() {
    /** @type {string[]} */
    const evicted = [];
    for (const key of this.order.keys()) {
      if (this.order.size - evicted.length <= this.capacity) break;
      evicted.push(key);
    }
    for (const key of evicted) this.order.delete(key);
    return evicted;
  }

  /** @returns {string[]} all keys, least recently used first */
  keys() {
    return [...this.order.keys()];
  }
}
