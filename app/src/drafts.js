// Drafts on the device (ADR 0003): Proposals not yet submitted, kept in
// IndexedDB with their photos as blobs, so they survive closing the app and
// work without network. Each Draft has an idempotency key, so a submit that
// was interrupted can be retried without creating a second Proposal.

import { KINDS } from './proposal-build.js';
import { hex } from './text.js';

/** @typedef {import('./proposal-build.js').KindForm} KindForm */
/** @typedef {import('./types.js').SubmitProposalBody} SubmitProposalBody */

const DB_NAME = 'rodokmen-drafts';
const DB_VERSION = 1;
/** Unsubmitted Drafts older than this get a warning (browsers may evict storage). */
export const STALE_DRAFT_DAYS = 7;
/** Warn when this share of the browser's quota is used. */
export const QUOTA_WARNING = 0.8;

/**
 * @typedef {object} DraftMeta
 * @property {string} id
 * @property {string} idempotencyKey
 * @property {string} createdAt ISO time
 * @property {string} updatedAt ISO time
 * @property {{ id: string, question: string }} [lead] the Research lead the finding answers ("Start from this lead")
 */

/**
 * A Draft: its kind and the form as the Member filled it in. `pending` is the
 * exact body of a submit whose answer was lost: the Proposal may exist, so
 * only that body may be sent again (with the same idempotency key).
 * @typedef {DraftMeta & KindForm & { pending?: SubmitProposalBody }} Draft
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

/**
 * Creates the stores a version needs. Each step runs only on devices older than
 * its version, so a device on any older version is brought up to date.
 * @param {IDBDatabase} db
 * @param {number} oldVersion
 */
function upgrade(db, oldVersion) {
  if (oldVersion < 1) {
    db.createObjectStore('drafts', { keyPath: 'id' });
    db.createObjectStore('photos', { keyPath: 'id' }).createIndex('draftId', 'draftId');
  }
}

/**
 * The database, opened once. A failed open is not kept, so the next call tries
 * again; a newer version of the app in another tab may close it to upgrade.
 * @returns {Promise<IDBDatabase>}
 */
function open() {
  if (opening) return opening;
  /** @type {Promise<IDBDatabase>} */
  const attempt = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => upgrade(request.result, event.oldVersion);
    request.onblocked = () => reject(new Error("The Drafts storage is being upgraded; close the app's other tabs."));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        if (opening === attempt) opening = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB did not open'));
  });
  opening = attempt;
  attempt.catch(() => {
    if (opening === attempt) opening = null;
  });
  return attempt;
}

/**
 * Runs requests in one transaction; resolves with the result of the request
 * `fn` returns once the transaction completes, and rejects when it fails.
 * @param {('drafts' | 'photos')[]} stores
 * @param {IDBTransactionMode} mode
 * @param {(tx: IDBTransaction) => IDBRequest | void} fn
 * @param {boolean} [commit] commit as soon as `fn` has made its requests (none may follow from callbacks)
 * @returns {Promise<unknown>}
 */
async function transact(stores, mode, fn, commit = false) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    /** @type {IDBRequest | void} */
    let request;
    try {
      request = fn(tx);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      try {
        tx.abort();
      } catch {
        // already finished
      }
      return;
    }
    tx.oncomplete = () => resolve(request ? request.result : undefined);
    // Without an explicit commit, a write made while the page closes (pagehide) can be lost with the page.
    if (commit) tx.commit();
  });
}

/**
 * One request on one store, in its own transaction.
 * @param {'drafts' | 'photos'} store
 * @param {IDBTransactionMode} mode
 * @param {(s: IDBObjectStore) => IDBRequest} fn
 */
function run(store, mode, fn) {
  return transact([store], mode, (tx) => fn(tx.objectStore(store)), true);
}

/**
 * Records read back from IndexedDB are checked, not trusted: an older version of the app may have written them.
 * @param {unknown} v
 * @returns {v is Draft}
 */
function isDraft(v) {
  return (
    typeof v === 'object' &&
    v !== null &&
    'id' in v &&
    typeof v.id === 'string' &&
    'kind' in v &&
    KINDS.some((k) => k === v.kind) &&
    'form' in v &&
    typeof v.form === 'object' &&
    v.form !== null
  );
}

/**
 * @param {unknown} v
 * @returns {v is DraftPhoto}
 */
function isPhoto(v) {
  return typeof v === 'object' && v !== null && 'id' in v && typeof v.id === 'string' && 'blob' in v && v.blob instanceof Blob;
}

/** A random key, URL-safe. */
export function newKey() {
  return hex(crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * @param {KindForm} kindForm
 * @returns {Draft}
 */
export function newDraft(kindForm) {
  const now = new Date().toISOString();
  return { id: newKey(), idempotencyKey: newKey(), createdAt: now, updatedAt: now, ...kindForm };
}

/** @returns {Promise<Draft[]>} newest first */
export async function listDrafts() {
  const all = await run('drafts', 'readonly', (s) => s.getAll());
  return (Array.isArray(all) ? all.filter(isDraft) : []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** @param {string} id @returns {Promise<Draft | undefined>} */
export async function getDraft(id) {
  const draft = await run('drafts', 'readonly', (s) => s.get(id));
  return isDraft(draft) ? draft : undefined;
}

/** @param {Draft} draft */
export async function saveDraft(draft) {
  await run('drafts', 'readwrite', (s) => s.put({ ...draft, updatedAt: new Date().toISOString() }));
}

/**
 * Deletes a Draft and its photos, all or nothing.
 * @param {string} id
 */
export async function deleteDraft(id) {
  await transact(['drafts', 'photos'], 'readwrite', (tx) => {
    tx.objectStore('drafts').delete(id);
    const photos = tx.objectStore('photos');
    const keys = photos.index('draftId').getAllKeys(id);
    keys.onsuccess = () => {
      for (const key of keys.result) photos.delete(key);
    };
  });
}

/** @param {string} draftId @returns {Promise<DraftPhoto[]>} */
export async function draftPhotos(draftId) {
  const photos = await run('photos', 'readonly', (s) => s.index('draftId').getAll(draftId));
  return Array.isArray(photos) ? photos.filter(isPhoto) : [];
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
