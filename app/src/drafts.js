// Drafts on the device (ADR 0003): Proposals not yet submitted, kept in
// IndexedDB with their photos as blobs, so they survive closing the app and
// work without network. Each Draft has an idempotency key, so a submit that
// was interrupted can be retried without creating a second Proposal.

const DB_NAME = 'rodokmen-drafts';
const DB_VERSION = 1;
/** Unsubmitted Drafts older than this get a warning (browsers may evict storage). */
export const STALE_DRAFT_DAYS = 7;
/** Warn when this share of the browser's quota is used. */
export const QUOTA_WARNING = 0.8;

/**
 * @typedef {object} Draft
 * @property {string} id
 * @property {string} kind baptism, marriage, death, name or correction
 * @property {string} idempotencyKey
 * @property {string} createdAt ISO time
 * @property {string} updatedAt ISO time
 * @property {Record<string, any>} form the form as the Member filled it in
 */

/**
 * @typedef {object} DraftPhoto
 * @property {string} id
 * @property {string} draftId
 * @property {Blob} blob
 * @property {string} name
 * @property {string | null} uploadId set once uploaded, so a retried submit does not upload it again
 */

/** @type {Promise<IDBDatabase> | null} */
let opening = null;

/** @returns {Promise<IDBDatabase>} */
function open() {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('drafts', { keyPath: 'id' });
      db.createObjectStore('photos', { keyPath: 'id' }).createIndex('draftId', 'draftId');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opening;
}

/**
 * @template T
 * @param {'drafts' | 'photos'} store
 * @param {IDBTransactionMode} mode
 * @param {(s: IDBObjectStore) => IDBRequest<T>} fn
 * @returns {Promise<T>}
 */
async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** A random key, URL-safe. */
export function newKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @param {string} kind
 * @param {Record<string, any>} form
 * @returns {Draft}
 */
export function newDraft(kind, form) {
  const now = new Date().toISOString();
  return { id: newKey(), kind, idempotencyKey: newKey(), createdAt: now, updatedAt: now, form };
}

/** @returns {Promise<Draft[]>} newest first */
export async function listDrafts() {
  /** @type {Draft[]} */
  const all = await run('drafts', 'readonly', (s) => s.getAll());
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** @param {string} id @returns {Promise<Draft | undefined>} */
export function getDraft(id) {
  return run('drafts', 'readonly', (s) => s.get(id));
}

/** @param {Draft} draft */
export async function saveDraft(draft) {
  await run('drafts', 'readwrite', (s) => s.put({ ...draft, updatedAt: new Date().toISOString() }));
}

/** @param {string} id */
export async function deleteDraft(id) {
  for (const photo of await draftPhotos(id)) await run('photos', 'readwrite', (s) => s.delete(photo.id));
  await run('drafts', 'readwrite', (s) => s.delete(id));
}

/** @param {string} draftId @returns {Promise<DraftPhoto[]>} */
export function draftPhotos(draftId) {
  return run('photos', 'readonly', (s) => s.index('draftId').getAll(draftId));
}

/** @param {DraftPhoto} photo */
export async function savePhoto(photo) {
  await run('photos', 'readwrite', (s) => s.put(photo));
}

/** @param {string} id */
export async function deletePhoto(id) {
  await run('photos', 'readwrite', (s) => s.delete(id));
}

/**
 * Asks the browser not to evict our storage. Returns whether it agreed.
 * @returns {Promise<boolean>}
 */
export async function requestPersistence() {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/** @returns {Promise<{ usage: number, quota: number } | null>} */
export async function storageEstimate() {
  try {
    const e = await navigator.storage?.estimate?.();
    return e && e.quota ? { usage: e.usage ?? 0, quota: e.quota } : null;
  } catch {
    return null;
  }
}

/**
 * @param {Draft} draft
 * @param {Date} [now]
 */
export function isStale(draft, now = new Date()) {
  return now.getTime() - new Date(draft.updatedAt).getTime() > STALE_DRAFT_DAYS * 86_400_000;
}
