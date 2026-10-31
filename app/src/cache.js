// The Tree data a signed-in Member last loaded, kept on the device so it stays readable
// offline (family-view spec, "Family data offline"; add-family-view design, "Local cache").
// Records are kept in IndexedDB by key ("person:<id>", "hourglass:<id>:3:2", "me", …) with the
// time they were loaded. Only viewed records are kept, at most CACHE_LIMIT, the least recently
// used going first. Nothing is cached for someone who is not signed in, and signing out (or a
// session that has ended) empties it.

import { ApiError } from './api.js';

const DB_NAME = 'rodokmen-cache';
const DB_VERSION = 1;
const STORE = 'records';
export const CACHE_LIMIT = 400;

/**
 * @typedef {object} CachedRecord
 * @property {string} key
 * @property {unknown} data
 * @property {string} cachedAt ISO time it was loaded from the server
 * @property {number} usedAt when it was last read or written (ms), for the eviction order
 */

/**
 * The keys to drop so that at most `limit` remain: the least recently used first.
 * @param {readonly { key: string, usedAt: number }[]} entries
 * @param {number} limit
 * @returns {string[]}
 */
export function toEvict(entries, limit) {
  if (entries.length <= limit) return [];
  return [...entries]
    .sort((a, b) => a.usedAt - b.usedAt || a.key.localeCompare(b.key))
    .slice(0, entries.length - limit)
    .map((e) => e.key);
}

/** @type {Promise<IDBDatabase> | null} */
let opening = null;

/** @returns {Promise<IDBDatabase>} */
function open() {
  if (opening) return opening;
  /** @type {Promise<IDBDatabase>} */
  const attempt = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        if (opening === attempt) opening = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB did not open'));
    request.onblocked = () => reject(new Error('The offline copy is being upgraded in another tab.'));
  });
  opening = attempt;
  attempt.catch(() => {
    if (opening === attempt) opening = null;
  });
  return attempt;
}

/**
 * @template T
 * @param {IDBTransactionMode} mode
 * @param {(store: IDBObjectStore) => IDBRequest<T>} fn
 * @returns {Promise<T>}
 */
async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/**
 * @param {unknown} value
 * @returns {value is CachedRecord}
 */
const isRecord = (value) => typeof value === 'object' && value !== null && 'key' in value && 'cachedAt' in value && 'data' in value;

/**
 * A record from the cache, marked as used now; null when it has none or storage fails.
 * @param {string} key
 * @returns {Promise<{ data: unknown, cachedAt: string } | null>}
 */
export async function readCached(key) {
  try {
    /** @type {unknown} */
    const found = await run('readonly', (s) => s.get(key));
    if (!isRecord(found)) return null;
    await run('readwrite', (s) => s.put({ ...found, usedAt: Date.now() }));
    return { data: found.data, cachedAt: found.cachedAt };
  } catch (error) {
    console.warn('The offline copy could not be read.', error);
    return null;
  }
}

/**
 * Keeps a record loaded just now, and drops the least recently used beyond CACHE_LIMIT.
 * @param {string} key
 * @param {unknown} data
 */
export async function writeCached(key, data) {
  try {
    await run('readwrite', (s) => s.put({ key, data, cachedAt: new Date().toISOString(), usedAt: Date.now() }));
    /** @type {unknown[]} */
    const all = await run('readonly', (s) => s.getAll());
    const entries = all.filter(isRecord).map((r) => ({ key: r.key, usedAt: r.usedAt }));
    for (const key of toEvict(entries, CACHE_LIMIT)) await run('readwrite', (s) => s.delete(key));
  } catch (error) {
    // Storage full or blocked: the page still shows what it loaded.
    console.warn('The offline copy could not be kept.', error);
  }
}

/** Empties the cache (signing out, or a session that ended). */
export async function clearCache() {
  try {
    await run('readwrite', (s) => s.clear());
  } catch (error) {
    console.warn('The offline copy could not be emptied.', error);
  }
}

/**
 * Loads a record cache first: `show` gets the cached copy at once with the time it was loaded,
 * then the fresh one with null. Without a connection the cached copy stays; without either the
 * error goes to the caller.
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} fetcher
 * @param {(data: T, asOf: string | null) => void} show
 * @param {{ cache: boolean, signal?: AbortSignal }} options cache: false for someone not signed in
 */
export async function loadThrough(key, fetcher, show, options) {
  const cached = options.cache ? await readCached(key) : null;
  if (options.signal?.aborted) return;
  if (cached) show(/** @type {T} */ (cached.data), cached.cachedAt);
  let fresh;
  try {
    fresh = await fetcher();
  } catch (error) {
    if (cached && error instanceof ApiError && error.offline) return;
    throw error;
  }
  if (options.signal?.aborted) return;
  show(fresh, null);
  if (options.cache) await writeCached(key, fresh);
}
